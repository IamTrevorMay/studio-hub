// supabase/functions/drive-watch-register/index.ts
// Registers a polling watch on a Drive folder. drive-watch-poll picks it up
// on its next minutely cron tick and starts emitting drive_events rows for
// every file whose modifiedTime advances past the watch's last_seen_time.
//
// No Drive API call is needed here — the folder just has to be readable by
// the service account associated with GOOGLE_DRIVE_REFRESH_TOKEN. We do a
// lightweight `files.get` to fail loudly if access is misconfigured.
//
// Auth: admin Supabase JWT.
// POST { folderId: string, label: string } -> { watch: row }

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
    const trimmedLabel = String(label).trim().slice(0, 200);
    if (!trimmedLabel) {
      return new Response(JSON.stringify({ error: "label cannot be empty" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    // Verify the service account can actually see the folder. Cheap and gives
    // the admin a clear "share the folder first" error instead of letting the
    // poller silently 404 every minute.
    const accessToken = await getDriveAccessToken();
    const probeRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?fields=id,name,mimeType&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!probeRes.ok) {
      const errText = await probeRes.text();
      return new Response(
        JSON.stringify({
          error: `Service account cannot access folder (${probeRes.status}). Share the folder with the service-account email and retry.`,
          detail: errText,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const probe = await probeRes.json();
    if (probe.mimeType !== "application/vnd.google-apps.folder") {
      return new Response(JSON.stringify({ error: "folderId is not a folder" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: row, error: insertError } = await admin
      .from("drive_watches")
      .insert({
        folder_id: folderId,
        label: trimmedLabel,
        mode: "poll",
        last_seen_time: new Date().toISOString(),
        created_by: user.id,
      })
      .select()
      .single();
    if (insertError) throw new Error(insertError.message);

    return new Response(JSON.stringify({ watch: row, folder_name: probe.name }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
