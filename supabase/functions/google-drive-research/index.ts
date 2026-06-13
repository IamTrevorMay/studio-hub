import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// Research documents live in a single shared Drive folder. Every research doc
// is a copy of the template below. Open to all authenticated users (no admin
// gate) — unlike google-drive-resources.
const FOLDER_ID = "16qph_sGOkg4YEmoQWjvMur6kwl9pUpkt";
const TEMPLATE_DOC_ID = "1F3PfPfTQSvkMWqtsUJpIBc-pdZtQGZg7U8mcxCsY06M";

const DOC_MIME = "application/vnd.google-apps.document";

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

// Confirm a file lives directly inside the research folder before mutating it,
// so callers can't rename/delete arbitrary Drive files via this function.
async function isInFolder(accessToken: string, fileId: string): Promise<boolean> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=parents&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const data = await res.json();
  if (!res.ok) return false;
  return (data.parents || []).includes(FOLDER_ID);
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

    const accessToken = await getDriveAccessToken();

    // ── List research documents in the folder ──
    if (req.method === "GET") {
      const query =
        `'${FOLDER_ID}' in parents and trashed = false and mimeType = '${DOC_MIME}'`;

      const driveRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?` +
        new URLSearchParams({
          q: query,
          fields: "files(id,name,webViewLink,modifiedTime,createdTime,owners(displayName))",
          orderBy: "modifiedTime desc",
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
        url: f.webViewLink,
        modifiedTime: f.modifiedTime,
        createdTime: f.createdTime,
        owner: f.owners?.[0]?.displayName || null,
      }));

      return new Response(JSON.stringify({ items }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method === "POST") {
      const body = await req.json();
      const action = body.action;

      // ── Create a new research doc by copying the template, then merge
      //    the submitted field values into the {{token}} placeholders. ──
      if (action === "create-from-template") {
        const { name, fields } = body;
        if (!name?.trim()) throw new Error("name is required");

        const res = await fetch(
          `https://www.googleapis.com/drive/v3/files/${TEMPLATE_DOC_ID}/copy?` +
          new URLSearchParams({
            supportsAllDrives: "true",
            fields: "id,name,webViewLink",
          }),
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              name: name.trim(),
              parents: [FOLDER_ID],
            }),
          }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || "Drive API error");

        // Merge fields → template tokens. Every {{key}} is replaced (optional
        // fields collapse to empty so no stray tokens remain in the doc).
        const requests = Object.entries(fields || {}).map(([key, value]) => ({
          replaceAllText: {
            containsText: { text: `{{${key}}}`, matchCase: true },
            replaceText: (value ?? "").toString(),
          },
        }));
        if (requests.length > 0) {
          const upd = await fetch(
            `https://docs.googleapis.com/v1/documents/${data.id}:batchUpdate`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ requests }),
            }
          );
          const updData = await upd.json();
          if (!upd.ok) throw new Error(updData.error?.message || "Docs API error");
        }

        return new Response(JSON.stringify({
          id: data.id,
          name: data.name,
          url: data.webViewLink,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (action === "rename") {
        const { id, name } = body;
        if (!id || !name?.trim()) throw new Error("id and name are required");
        if (!/^[\w\-]+$/.test(id)) throw new Error("Invalid id");
        if (!(await isInFolder(accessToken, id))) throw new Error("Document is outside the Research folder");

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
        if (!/^[\w\-]+$/.test(id)) throw new Error("Invalid id");
        if (!(await isInFolder(accessToken, id))) throw new Error("Document is outside the Research folder");

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
