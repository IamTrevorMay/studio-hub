import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// Root folder path — users cannot navigate above this
const ROOT_PATH = ["Business", "YouTube", "Trevor May Baseball", "Long Form"];

// Cache resolved root folder ID across requests (edge function instance lifetime)
let cachedRootId: string | null = null;

// Get a fresh access token using the shared Drive refresh token
async function getDriveAccessToken(): Promise<string> {
  const clientId = Deno.env.get("GOOGLE_DRIVE_CLIENT_ID")!;
  const clientSecret = Deno.env.get("GOOGLE_DRIVE_CLIENT_SECRET")!;
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

// Resolve a folder path from Drive root, returning the final folder's ID
async function resolveRootFolder(accessToken: string): Promise<string> {
  if (cachedRootId) return cachedRootId;

  let currentId = "root";
  for (const name of ROOT_PATH) {
    const query = `'${currentId}' in parents and name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?` +
      new URLSearchParams({
        q: query,
        fields: "files(id)",
        pageSize: "1",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
      }),
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const data = await res.json();
    if (!res.ok || !data.files?.length) {
      throw new Error(`Could not find Drive folder: ${name}`);
    }
    currentId = data.files[0].id;
  }

  cachedRootId = currentId;
  return currentId;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Verify caller is authenticated
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

    const accessToken = await getDriveAccessToken();
    const rootId = await resolveRootFolder(accessToken);
    const url = new URL(req.url);

    if (req.method === "GET") {
      // List folders in a parent (default to root folder)
      const parentId = url.searchParams.get("parentId") || rootId;
      const query = `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;

      const driveRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?` +
        new URLSearchParams({
          q: query,
          fields: "files(id,name)",
          orderBy: "name",
          pageSize: "200",
          supportsAllDrives: "true",
          includeItemsFromAllDrives: "true",
        }),
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      const data = await driveRes.json();
      if (!driveRes.ok) throw new Error(data.error?.message || "Drive API error");

      return new Response(JSON.stringify({ folders: data.files || [], rootId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method === "POST") {
      // Create a new folder
      const body = await req.json();
      const { parentId, name } = body;

      if (!name) {
        return new Response(JSON.stringify({ error: "name is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const driveRes = await fetch(
        "https://www.googleapis.com/drive/v3/files?supportsAllDrives=true",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name,
            mimeType: "application/vnd.google-apps.folder",
            parents: [parentId || rootId],
          }),
        }
      );

      const data = await driveRes.json();
      if (!driveRes.ok) throw new Error(data.error?.message || "Drive API error");

      return new Response(JSON.stringify({ id: data.id, name: data.name }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
