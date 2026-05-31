// supabase/functions/drive-watch-register/index.ts
// Registers a Drive `files.watch` channel on a folder so Google pushes
// change notifications to drive-watch-webhook whenever something inside
// that folder is added, modified, or trashed.
//
// Auth: admin Supabase JWT.
// Drive credentials: shared service-account refresh token (same pattern
// as drive-list-clips and drive-upload-init).
//
// POST { folderId: string, label: string } -> { watch: row }
//
// Prereqs (one-time per project):
//   1. Verify the Supabase Functions domain in Google Search Console under
//      the GCP project that issued GOOGLE_CLIENT_ID. Drive rejects watches
//      that target unverified webhook domains.
//   2. Share the folder with the service account associated with
//      GOOGLE_DRIVE_REFRESH_TOKEN, otherwise files.watch returns 404.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function getDriveAccessToken(): Promise<string> {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID")!;
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
  const refreshToken = Deno.env.get("GOOGLE_DRIVE_REFRESH_TOKEN")!;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single();
    if (profile?.role !== "admin") {
      return new Response(JSON.stringify({ error: "Admin only" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { folderId, label } = await req.json();
    if (!folderId || !label) {
      return new Response(JSON.stringify({ error: "folderId and label are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!/^[\w\-]+$/.test(folderId)) {
      return new Response(JSON.stringify({ error: "Invalid folderId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Block duplicate active watches on the same folder.
    const { data: existing } = await admin
      .from("drive_watches")
      .select("id")
      .eq("folder_id", folderId)
      .is("stopped_at", null)
      .maybeSingle();
    if (existing) {
      return new Response(JSON.stringify({ error: "Folder already has an active watch", watchId: existing.id }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken = await getDriveAccessToken();
    const channelId = crypto.randomUUID();
    const token = randomToken();
    const webhookUrl = `${supabaseUrl}/functions/v1/drive-watch-webhook`;

    // Google accepts a max channel lifetime of ~7 days for files.watch.
    const ttlMs = 7 * 24 * 60 * 60 * 1000;
    const expiration = Date.now() + ttlMs;

    const watchRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}/watch?supportsAllDrives=true`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: channelId,
          type: "web_hook",
          address: webhookUrl,
          token,
          expiration: String(expiration),
        }),
      },
    );
    const watchBody = await watchRes.json();
    if (!watchRes.ok) {
      throw new Error(`Drive watch failed: ${watchRes.status} ${JSON.stringify(watchBody)}`);
    }

    const resourceId = watchBody.resourceId as string;
    const grantedExpiration = watchBody.expiration ? new Date(Number(watchBody.expiration)) : new Date(expiration);

    const { data: row, error: insertError } = await admin
      .from("drive_watches")
      .insert({
        folder_id: folderId,
        label,
        channel_id: channelId,
        resource_id: resourceId,
        webhook_token: token,
        expiration: grantedExpiration.toISOString(),
        last_seen_time: new Date().toISOString(),
        created_by: user.id,
      })
      .select()
      .single();
    if (insertError) throw new Error(insertError.message);

    return new Response(JSON.stringify({ watch: row }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
