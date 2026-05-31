// supabase/functions/drive-watch-renew/index.ts
// Renews any drive_watches whose channel is within 24h of expiring. Drive
// caps channel lifetime at ~7 days, so we run this hourly from pg_cron.
// For each candidate:
//   1. Register a new files.watch channel for the same folder.
//   2. Update the row with the new channel_id/resource_id/token/expiration.
//   3. Stop the previous channel via channels.stop.
//
// Auth: CRON_SECRET in the Authorization header (Bearer ...) OR ?secret=.
// Same pattern as drive-list-clips' cron callers.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function getDriveAccessToken(): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      refresh_token: Deno.env.get("GOOGLE_DRIVE_REFRESH_TOKEN")!,
      grant_type: "refresh_token",
    }),
  });
  const tokens = await res.json();
  if (!res.ok) throw new Error(tokens.error_description || "Token refresh failed");
  return tokens.access_token;
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function stopChannel(accessToken: string, channelId: string, resourceId: string): Promise<void> {
  await fetch("https://www.googleapis.com/drive/v3/channels/stop", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ id: channelId, resourceId }),
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const cronSecret = Deno.env.get("CRON_SECRET");
  const url = new URL(req.url);
  const auth = req.headers.get("Authorization");
  const querySecret = url.searchParams.get("secret");
  const ok = cronSecret && (auth === `Bearer ${cronSecret}` || querySecret === cronSecret);
  if (!ok) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const cutoff = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { data: candidates, error: selectErr } = await admin
      .from("drive_watches")
      .select("*")
      .is("stopped_at", null)
      .lt("expiration", cutoff);
    if (selectErr) throw new Error(selectErr.message);

    if (!candidates || candidates.length === 0) {
      return new Response(JSON.stringify({ renewed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken = await getDriveAccessToken();
    const webhookUrl = `${supabaseUrl}/functions/v1/drive-watch-webhook`;
    const ttlMs = 7 * 24 * 60 * 60 * 1000;

    let renewed = 0;
    const errors: Array<{ watchId: string; error: string }> = [];

    for (const watch of candidates) {
      try {
        const newChannelId = crypto.randomUUID();
        const newToken = randomToken();
        const expiration = Date.now() + ttlMs;

        const watchRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(watch.folder_id)}/watch?supportsAllDrives=true`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              id: newChannelId,
              type: "web_hook",
              address: webhookUrl,
              token: newToken,
              expiration: String(expiration),
            }),
          },
        );
        const watchBody = await watchRes.json();
        if (!watchRes.ok) {
          throw new Error(`Drive watch failed: ${watchRes.status} ${JSON.stringify(watchBody)}`);
        }
        const newResourceId = watchBody.resourceId as string;
        const grantedExpiration = watchBody.expiration ? new Date(Number(watchBody.expiration)) : new Date(expiration);

        const prevChannelId = watch.channel_id;
        const prevResourceId = watch.resource_id;

        const { error: updateErr } = await admin
          .from("drive_watches")
          .update({
            channel_id: newChannelId,
            resource_id: newResourceId,
            webhook_token: newToken,
            expiration: grantedExpiration.toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", watch.id);
        if (updateErr) throw new Error(updateErr.message);

        // Best-effort stop of the previous channel after the new one is live.
        await stopChannel(accessToken, prevChannelId, prevResourceId);
        renewed += 1;
      } catch (err) {
        errors.push({ watchId: watch.id, error: (err as Error).message });
      }
    }

    return new Response(JSON.stringify({ renewed, errors }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
