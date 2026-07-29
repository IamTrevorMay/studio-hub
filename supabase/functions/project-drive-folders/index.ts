import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Per-project-type Drive root folders. Clients send a type, never a folder id,
// so this function can only ever list inside these four roots.
const TYPE_ROOTS: Record<string, string> = {
  tm_baseball_video: "1XeOq5RF2Ximb8HW7vtzL9OU2H75K_YRA", // Trevor May Baseball
  mayday_video: "17wMeEBzWCop241Hewq23ntAV242g6mhF",      // Mayday
  short_form: "1KXAcH6Bi5_a46ts0k6h8u6FgWaddFOAz",        // Short Form
  podcast: "15D7JCxPdMj-HrnTMmIO00Bn7fpSoJC22",           // Podcast
};

const FOLDER_MIME = "application/vnd.google-apps.folder";
const STAFF_ROLES = new Set(["admin", "director", "member", "director_creative", "director_comms"]);

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
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    if (!profile || !STAFF_ROLES.has(profile.role)) {
      return new Response(JSON.stringify({ error: "Staff access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { type } = await req.json();
    const rootId = TYPE_ROOTS[type];
    if (!rootId) throw new Error(`Unknown project type: ${type}`);

    const accessToken = await getDriveAccessToken();
    const query = `'${rootId}' in parents and trashed = false and mimeType = '${FOLDER_MIME}'`;

    const driveRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?` +
      new URLSearchParams({
        q: query,
        fields: "files(id,name,webViewLink)",
        orderBy: "name",
        pageSize: "500",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
      }),
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    const data = await driveRes.json();
    if (!driveRes.ok) throw new Error(data.error?.message || "Drive API error");

    const items = (data.files || []).map((f: { id: string; name: string; webViewLink: string }) => ({
      id: f.id,
      name: f.name,
      url: f.webViewLink,
    }));

    return new Response(JSON.stringify({ items, rootId, rootUrl: `https://drive.google.com/drive/folders/${rootId}` }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
