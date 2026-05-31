// supabase/functions/drive-whoami/index.ts
// Diagnostic. Returns whoami + a list of files the service-account refresh
// token sees in a given folder. Safe to delete after debugging.
//
// GET ?secret=...&folderId=<id>

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

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
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
        client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
        refresh_token: Deno.env.get("GOOGLE_DRIVE_REFRESH_TOKEN")!,
        grant_type: "refresh_token",
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(tokens.error_description || "Token refresh failed");
    const accessToken = tokens.access_token;

    const aboutRes = await fetch(
      "https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress,permissionId)",
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const about = await aboutRes.json();

    const folderId = url.searchParams.get("folderId");
    let folder: unknown = null;
    let files: unknown = null;

    if (folderId) {
      const folderRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?fields=id,name,mimeType,owners(emailAddress),capabilities&supportsAllDrives=true`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      folder = await folderRes.json();

      const listRes = await fetch(
        "https://www.googleapis.com/drive/v3/files?" + new URLSearchParams({
          q: `'${folderId}' in parents`,
          fields: "files(id,name,mimeType,createdTime,modifiedTime,trashed,parents,owners(emailAddress),lastModifyingUser(emailAddress,displayName))",
          orderBy: "modifiedTime desc",
          pageSize: "50",
          supportsAllDrives: "true",
          includeItemsFromAllDrives: "true",
        }),
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      files = await listRes.json();
    }

    return new Response(JSON.stringify({ about, folder, files }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
