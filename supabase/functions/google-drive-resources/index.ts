import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// Root folder ID for Resources — users cannot navigate above this.
// "HOW WE WORK" folder in Trevor's My Drive.
const ROOT_ID = "1KvMC2uXc3grw1rh23jQ16uLUEOd8hCqT";

const DOC_MIME = "application/vnd.google-apps.document";
const FOLDER_MIME = "application/vnd.google-apps.folder";

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

async function isDescendantOfRoot(accessToken: string, fileId: string, rootId: string): Promise<boolean> {
  if (fileId === rootId) return true;
  let currentId = fileId;
  for (let i = 0; i < 10; i++) {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${currentId}?fields=parents&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const data = await res.json();
    if (!res.ok) return false;
    const parents = data.parents || [];
    if (parents.includes(rootId)) return true;
    if (!parents.length) return false;
    currentId = parents[0];
    if (currentId === "root") return false;
  }
  return false;
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
    if (profile?.role !== "admin") {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken = await getDriveAccessToken();
    const rootId = ROOT_ID;
    const url = new URL(req.url);

    if (req.method === "GET") {
      const folderId = url.searchParams.get("folderId") || rootId;

      // Sanitize folderId before interpolating into Drive query string
      if (!/^[\w\-]+$/.test(folderId)) throw new Error("Invalid folderId");

      if (folderId !== rootId) {
        const ok = await isDescendantOfRoot(accessToken, folderId, rootId);
        if (!ok) throw new Error("Folder is outside Resources root");
      }

      const query =
        `'${folderId}' in parents and trashed = false and ` +
        `(mimeType = '${FOLDER_MIME}' or mimeType = '${DOC_MIME}')`;

      const driveRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?` +
        new URLSearchParams({
          q: query,
          fields: "files(id,name,mimeType,webViewLink,modifiedTime,createdTime,owners(displayName))",
          orderBy: "folder,name",
          pageSize: "500",
          supportsAllDrives: "true",
          includeItemsFromAllDrives: "true",
        }),
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      const data = await driveRes.json();
      if (!driveRes.ok) throw new Error(data.error?.message || "Drive API error");

      const items = (data.files || []).map((f: any) => ({
        id: f.id,
        name: f.name,
        type: f.mimeType === FOLDER_MIME ? "folder" : "doc",
        url: f.webViewLink,
        modifiedTime: f.modifiedTime,
        createdTime: f.createdTime,
        owner: f.owners?.[0]?.displayName || null,
      }));

      return new Response(JSON.stringify({ items, rootId, folderId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method === "POST") {
      const body = await req.json();
      const action = body.action;

      if (action === "create-folder" || action === "create-doc") {
        const { parentId, name } = body;
        if (!name?.trim()) throw new Error("name is required");
        const targetParent = parentId || rootId;
        if (targetParent !== rootId) {
          const ok = await isDescendantOfRoot(accessToken, targetParent, rootId);
          if (!ok) throw new Error("Parent folder is outside Resources root");
        }

        const mimeType = action === "create-folder" ? FOLDER_MIME : DOC_MIME;
        const res = await fetch(
          "https://www.googleapis.com/drive/v3/files?" +
          new URLSearchParams({
            supportsAllDrives: "true",
            fields: "id,name,mimeType,webViewLink",
          }),
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              name: name.trim(),
              mimeType,
              parents: [targetParent],
            }),
          }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || "Drive API error");

        return new Response(JSON.stringify({
          id: data.id,
          name: data.name,
          type: action === "create-folder" ? "folder" : "doc",
          url: data.webViewLink,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (action === "rename") {
        const { id, name } = body;
        if (!id || !name?.trim()) throw new Error("id and name are required");
        const ok = await isDescendantOfRoot(accessToken, id, rootId);
        if (!ok) throw new Error("Item is outside Resources root");

        const res = await fetch(
          `https://www.googleapis.com/drive/v3/files/${id}?supportsAllDrives=true`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ name: name.trim() }),
          }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || "Drive API error");
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (action === "delete") {
        const { id } = body;
        if (!id) throw new Error("id is required");
        const ok = await isDescendantOfRoot(accessToken, id, rootId);
        if (!ok) throw new Error("Item is outside Resources root");

        const res = await fetch(
          `https://www.googleapis.com/drive/v3/files/${id}?supportsAllDrives=true`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ trashed: true }),
          }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || "Drive API error");
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (action === "move") {
        const { id, newParentId } = body;
        if (!id || !newParentId) throw new Error("id and newParentId are required");
        const okItem = await isDescendantOfRoot(accessToken, id, rootId);
        const okParent = newParentId === rootId || await isDescendantOfRoot(accessToken, newParentId, rootId);
        if (!okItem || !okParent) throw new Error("Item or target is outside Resources root");

        const fileRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${id}?fields=parents&supportsAllDrives=true`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        const fileData = await fileRes.json();
        const previousParents = (fileData.parents || []).join(",");

        const moveRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${id}?addParents=${newParentId}&removeParents=${previousParents}&supportsAllDrives=true`,
          {
            method: "PATCH",
            headers: { Authorization: `Bearer ${accessToken}` },
          }
        );
        const moveData = await moveRes.json();
        if (!moveRes.ok) throw new Error(moveData.error?.message || "Drive API error");
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      throw new Error(`Unknown action: ${action}`);
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
