import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

// Contractors root folder in Google Drive
const ROOT_ID = "1IagT9eCUtPFvbOm2X9rkxW9RhG8G07Kj";

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
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Admin-only
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (profile?.role !== "admin") {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken = await getDriveAccessToken();
    const driveHeaders = { Authorization: `Bearer ${accessToken}` };
    const driveParams = {
      fields: "files(id,name)",
      orderBy: "name",
      pageSize: "200",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    };

    // Fetch top-level folders
    const topQuery = `'${ROOT_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const topRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?` +
      new URLSearchParams({ q: topQuery, ...driveParams }),
      { headers: driveHeaders }
    );
    const topData = await topRes.json();
    if (!topRes.ok) throw new Error(topData.error?.message || "Drive API error");

    const topFolders: { id: string; name: string }[] = topData.files || [];
    const allFolders: { id: string; name: string }[] = [...topFolders];

    // Fetch one level of subfolders for each top-level folder (in parallel)
    const subRequests = topFolders.map(async (parent) => {
      const subQuery = `'${parent.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
      const subRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?` +
        new URLSearchParams({ q: subQuery, ...driveParams }),
        { headers: driveHeaders }
      );
      const subData = await subRes.json();
      if (subRes.ok && subData.files) {
        for (const child of subData.files) {
          allFolders.push({ id: child.id, name: `${parent.name} / ${child.name}` });
        }
      }
    });
    await Promise.all(subRequests);

    // Sort alphabetically by display name
    allFolders.sort((a, b) => a.name.localeCompare(b.name));

    return new Response(JSON.stringify({ folders: allFolders }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
