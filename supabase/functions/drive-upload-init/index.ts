// supabase/functions/drive-upload-init/index.ts
// Initiates a Drive resumable upload session and returns the upload URL to the
// browser. The browser then PUTs the file bytes directly to that URL — keeping
// the video out of Supabase's edge function payload (6 MB hard cap) and out of
// any transit through our infrastructure.
//
// Auth: requires a valid Supabase user JWT. Drive credentials use the shared
// service-account refresh token, the same pattern as google-drive-resources.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  // Drive responds with the resumable upload URL in the Location header — we
  // forward it to the client as JSON, but expose it here too in case a future
  // direct-fetch flow wants to read it.
  "Access-Control-Expose-Headers": "Location",
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
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // Verify the caller is signed in to Studio
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { filename, parentFolderId, mimeType, sizeBytes } = await req.json();
    if (!filename || !parentFolderId || !mimeType) {
      return new Response(JSON.stringify({ error: "filename, parentFolderId, and mimeType are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken = await getDriveAccessToken();

    // Forward the browser's Origin so Google associates it with the resumable
    // upload URL and returns proper CORS headers on subsequent PUT requests.
    const rawOrigin = req.headers.get("Origin") || req.headers.get("Referer") || "";
    let clientOrigin = "*";
    try {
      if (rawOrigin) {
        const parsed = new URL(rawOrigin);
        clientOrigin = parsed.origin;
      }
    } catch {
      // Invalid URL — fall back to wildcard
    }

    // Initiate the resumable session. Drive returns the upload URL in the
    // Location header.
    const initRes = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          ...(sizeBytes ? { "X-Upload-Content-Length": String(sizeBytes) } : {}),
          "X-Upload-Content-Type": mimeType,
          Origin: clientOrigin,
        },
        body: JSON.stringify({
          name: filename,
          mimeType,
          parents: [parentFolderId],
        }),
      },
    );
    if (!initRes.ok) {
      const errText = await initRes.text();
      throw new Error(`Drive init failed: ${initRes.status} ${errText}`);
    }
    const uploadUrl = initRes.headers.get("Location");
    if (!uploadUrl) {
      throw new Error("Drive did not return a resumable upload URL");
    }

    return new Response(JSON.stringify({ uploadUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
