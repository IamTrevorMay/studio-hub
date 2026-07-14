// supabase/functions/pitch-video-drive/index.ts
// Folder picker backend for the Pitch Video Search tool's "Upload to Drive"
// flow. GET lists subfolders of a parent, POST creates a folder — both
// confined to the shared Pitch Videos root. Mirrors google-drive-folders but
// is open to any authenticated Studio user (the tool itself is all-roles),
// which is safe because every operation is fenced inside PITCH_VIDEOS_ROOT.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// Shared "Pitch Videos" folder — users cannot navigate above this.
const PITCH_VIDEOS_ROOT = "1evC6T-cSra_KF89QzQ0KhDeXR5a4a2g1";

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

// Walk a folder's parent chain to confirm it lives under the pitch root, so a
// caller can't list/create outside the allowed tree by passing an arbitrary id.
async function isDescendantOfRoot(accessToken: string, fileId: string, rootId: string): Promise<boolean> {
  if (fileId === rootId) return true;
  let currentId = fileId;
  for (let i = 0; i < 10; i++) {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${currentId}?fields=parents&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Any authenticated Studio user may browse/create inside the pitch root.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const accessToken = await getDriveAccessToken();

    if (req.method === "GET") {
      const url = new URL(req.url);

      // Name-search video files anywhere under the Pitch Videos tree. Used by
      // the Beat Sheets "Find Assets" feature to suggest pitch clips for a tag.
      const searchQ = (url.searchParams.get("search") || "").trim();
      if (searchQ) {
        const esc = searchQ.replace(/['\\]/g, " ").slice(0, 80);
        const driveRes = await fetch(
          `https://www.googleapis.com/drive/v3/files?` +
          new URLSearchParams({
            q: `name contains '${esc}' and mimeType contains 'video/' and trashed = false`,
            fields: "files(id,name,parents,mimeType,thumbnailLink,webViewLink)",
            orderBy: "name",
            pageSize: "25",
            supportsAllDrives: "true",
            includeItemsFromAllDrives: "true",
          }),
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        const data = await driveRes.json();
        if (!driveRes.ok) throw new Error(data.error?.message || "Drive API error");

        // Keep only files under the Pitch Videos root. Direct-parent match is
        // free; deeper files need a parent walk — bounded so a broad match
        // can't fan out into hundreds of Drive calls.
        const results: Array<Record<string, unknown>> = [];
        let walks = 0;
        for (const f of (data.files || [])) {
          if (results.length >= 8) break;
          const parents: string[] = f.parents || [];
          let under = parents.includes(PITCH_VIDEOS_ROOT);
          if (!under && parents.length && walks < 12) {
            walks++;
            under = await isDescendantOfRoot(accessToken, parents[0], PITCH_VIDEOS_ROOT);
          }
          if (under) {
            results.push({
              id: f.id,
              name: f.name,
              source: "pitch",
              type: "VIDEO",
              url: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
              thumbnail: f.thumbnailLink || null,
            });
          }
        }
        return json({ results, rootId: PITCH_VIDEOS_ROOT });
      }

      const parentId = url.searchParams.get("parentId") || PITCH_VIDEOS_ROOT;
      if (!/^[\w\-]+$/.test(parentId)) return json({ error: "Invalid parentId" }, 400);
      if (!(await isDescendantOfRoot(accessToken, parentId, PITCH_VIDEOS_ROOT))) {
        return json({ error: "parentId outside allowed root" }, 403);
      }

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
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const data = await driveRes.json();
      if (!driveRes.ok) throw new Error(data.error?.message || "Drive API error");

      return json({ folders: data.files || [], rootId: PITCH_VIDEOS_ROOT });
    }

    if (req.method === "POST") {
      const { parentId, name, copyId } = await req.json();
      const parent = parentId || PITCH_VIDEOS_ROOT;
      if (!/^[\w\-]+$/.test(parent)) return json({ error: "Invalid parentId" }, 400);

      // Copy an existing pitch video into another folder under the root
      // (Find Assets "push confirmed" — the bytes are already in Drive, so a
      // server-side copy beats a download/re-upload round trip).
      if (copyId) {
        if (!/^[\w\-]+$/.test(copyId)) return json({ error: "Invalid copyId" }, 400);
        if (!(await isDescendantOfRoot(accessToken, copyId, PITCH_VIDEOS_ROOT))) {
          return json({ error: "copyId outside allowed root" }, 403);
        }
        if (!(await isDescendantOfRoot(accessToken, parent, PITCH_VIDEOS_ROOT))) {
          return json({ error: "parentId outside allowed root" }, 403);
        }
        const copyRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${copyId}/copy?supportsAllDrives=true`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ parents: [parent] }),
          },
        );
        const copied = await copyRes.json();
        if (!copyRes.ok) throw new Error(copied.error?.message || "Drive copy failed");
        return json({ file: { id: copied.id, name: copied.name } });
      }

      if (!name || typeof name !== "string" || !name.trim()) {
        return json({ error: "Folder name required" }, 400);
      }
      if (!(await isDescendantOfRoot(accessToken, parent, PITCH_VIDEOS_ROOT))) {
        return json({ error: "parentId outside allowed root" }, 403);
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
            name: name.trim().slice(0, 200),
            mimeType: "application/vnd.google-apps.folder",
            parents: [parent],
          }),
        },
      );
      const data = await driveRes.json();
      if (!driveRes.ok) throw new Error(data.error?.message || "Drive API error");

      return json({ folder: { id: data.id, name: data.name } });
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (err) {
    console.error("pitch-video-drive error:", err);
    return json({ error: (err as Error).message || "Internal error" }, 500);
  }
});
