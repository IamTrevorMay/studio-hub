// supabase/functions/drive-list-clips/index.ts
// Lists video files in a recipient's Drive folder so the UI can import
// missed clips into the shorts_queue retroactively.
//
// Auth: Supabase JWT. Drive credentials use the shared service-account
// refresh token (same pattern as google-drive-folders, drive-upload-init).
//
// GET ?folderId=<id>            — all videos in the folder
// GET ?folderId=<id>&since=<ISO> — videos created on or after `since`

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Auth: accept either a valid Supabase user JWT or the CRON_SECRET header
    // (the latter lets CLI / cron callers bypass user auth).
    const authHeader = req.headers.get("Authorization");
    const cronSecret = Deno.env.get("CRON_SECRET");
    const isCron = cronSecret && authHeader === `Bearer ${cronSecret}`;

    if (!isCron) {
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "Missing authorization" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (req.method !== "GET") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const folderId = url.searchParams.get("folderId");
    if (!folderId) {
      return new Response(JSON.stringify({ error: "folderId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const since = url.searchParams.get("since"); // optional ISO date

    // Sanitize inputs before interpolating into Drive query string
    if (!/^[\w\-]+$/.test(folderId)) {
      return new Response(JSON.stringify({ error: "Invalid folderId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (since && isNaN(Date.parse(since))) {
      return new Response(JSON.stringify({ error: "Invalid since date" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build Drive query: videos in the target folder
    let query = `'${folderId}' in parents and trashed = false and mimeType contains 'video/'`;
    if (since) {
      query += ` and createdTime >= '${new Date(since).toISOString()}'`;
    }

    const accessToken = await getDriveAccessToken();

    const driveRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?` +
      new URLSearchParams({
        q: query,
        fields: "files(id,name,createdTime,webViewLink,mimeType)",
        orderBy: "createdTime desc",
        pageSize: "200",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
      }),
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    const data = await driveRes.json();
    if (!driveRes.ok) throw new Error(data.error?.message || "Drive API error");

    return new Response(JSON.stringify({ files: data.files || [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
