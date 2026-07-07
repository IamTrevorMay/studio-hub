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

// Best-effort server-side log of an upload-init failure. Uses the service role
// to bypass RLS so we capture the verbose Drive error the browser never sees.
async function logServerError(row: Record<string, unknown>): Promise<void> {
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    await admin.from("upload_errors").insert({ source: "server", phase: "init", ...row });
  } catch (_e) {
    // never let logging mask the real error
  }
}

// Shared submissions folder (mirrors the client constant in AppLayout /
// FreelancerDashboard). Non-admins may upload here or into their own assigned
// folder, nothing else.
const SUBMISSIONS_FOLDER_ID = "1r1dENUCjNSs57MjidYbE2rWrbMKXpLM0";

// Shared "Pitch Videos" folder — the Pitch Video Search tool (all roles)
// uploads clips here via the pitch-video-drive folder picker.
const PITCH_VIDEOS_FOLDER_ID = "1evC6T-cSra_KF89QzQ0KhDeXR5a4a2g1";

// Walk a folder's parent chain to confirm it lives under one of the allowed
// roots, so a non-admin can't target an arbitrary Drive folder by id.
async function isDescendantOf(accessToken: string, fileId: string, rootId: string): Promise<boolean> {
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

  // Populated as we go so the catch can log whatever context we reached.
  const logRow: Record<string, unknown> = {};
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
    if (user) logRow.user_id = user.id;
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: profile } = await supabase.from("profiles").select("role, assigned_drive_folder_id").eq("id", user.id).single();
    if (!["admin", "director_creative", "director_comms", "freelancer", "member"].includes(profile?.role)) {
      return new Response(JSON.stringify({ error: "Access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { filename, parentFolderId, mimeType, sizeBytes } = await req.json();
    logRow.filename = filename ?? null;
    logRow.mime_type = mimeType ?? null;
    logRow.size_bytes = sizeBytes ?? null;
    logRow.context = { parent_folder_id: parentFolderId ?? null };
    if (!filename || !parentFolderId || !mimeType) {
      return new Response(JSON.stringify({ error: "filename, parentFolderId, and mimeType are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken = await getDriveAccessToken();

    // IDOR guard: non-admins may only upload into the shared submissions folder,
    // their own assigned folder, or a configured Clipping Tool recipient folder
    // (or a descendant of any). Admins are trusted to target any folder. Without
    // this, any authenticated user could initiate an upload into an arbitrary
    // folder by passing its id.
    const adminTier = ["admin", "director_creative", "director_comms"].includes(profile.role);
    if (!adminTier) {
      if (!/^[\w\-]+$/.test(parentFolderId)) {
        return new Response(JSON.stringify({ error: "Invalid parentFolderId" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const roots = [SUBMISSIONS_FOLDER_ID, PITCH_VIDEOS_FOLDER_ID];
      if (profile.assigned_drive_folder_id) roots.push(profile.assigned_drive_folder_id);

      // Per-assignment submit-folder overrides: trust any folder an admin set as
      // the submit destination on one of this contractor's own assignments. RLS
      // scopes this read to rows where freelancer_id = the calling user.
      const { data: overrideRows } = await supabase
        .from("freelancer_assignments")
        .select("submit_folder_id")
        .eq("freelancer_id", user.id)
        .not("submit_folder_id", "is", null);
      if (overrideRows) {
        for (const r of overrideRows) {
          if (r.submit_folder_id) roots.push(r.submit_folder_id);
        }
      }

      // Include Clipping Tool recipient folders so non-admin clippers can upload.
      const { data: recipientFolders } = await supabase
        .from("clipping_tool_recipients")
        .select("drive_folder_id");
      if (recipientFolders) {
        for (const r of recipientFolders) {
          if (r.drive_folder_id) roots.push(r.drive_folder_id);
        }
      }

      let allowed = roots.includes(parentFolderId);
      for (const root of roots) {
        if (allowed) break;
        if (await isDescendantOf(accessToken, parentFolderId, root)) allowed = true;
      }
      if (!allowed) {
        await logServerError({ ...logRow, status_code: 403, error: "parentFolderId outside allowed folders" });
        return new Response(JSON.stringify({ error: "Folder not permitted" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

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
      await logServerError({ ...logRow, status_code: initRes.status, error: `Drive init failed: ${errText}` });
      return new Response(JSON.stringify({ error: `Drive init failed: ${initRes.status} ${errText}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const uploadUrl = initRes.headers.get("Location");
    if (!uploadUrl) {
      throw new Error("Drive did not return a resumable upload URL");
    }

    return new Response(JSON.stringify({ uploadUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    await logServerError({ ...logRow, error: (err as Error).message });
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
