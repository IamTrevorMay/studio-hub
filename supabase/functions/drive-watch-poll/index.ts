// supabase/functions/drive-watch-poll/index.ts
// Cron-driven poller. Walks every active drive_watches row in 'poll' mode,
// queries Drive for files in that folder with modifiedTime > last_seen_time,
// upserts drive_events for each change, and advances last_seen_time.
//
// Auth: CRON_SECRET in the Authorization header (Bearer ...) OR ?secret=
// query param — same pattern as drive-list-clips and the rotated cron jobs
// in 20260512130000_rotate_cron_secret.sql.
//
// Runs every minute via pg_cron. Per-folder Drive cost is one files.list
// call per minute (~1,440/day). Per-folder DB cost is one update + N upserts
// where N is the number of files that changed in the last minute (usually 0).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

type DriveFile = {
  id: string;
  name?: string;
  mimeType?: string;
  webViewLink?: string;
  createdTime?: string;
  modifiedTime?: string;
  trashed?: boolean;
  parents?: string[];
  lastModifyingUser?: {
    emailAddress?: string;
    displayName?: string;
    permissionId?: string;
  };
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
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: watches, error: selectErr } = await admin
      .from("drive_watches")
      .select("id, folder_id, last_seen_time")
      .is("stopped_at", null)
      .eq("mode", "poll");
    if (selectErr) throw new Error(selectErr.message);

    if (!watches || watches.length === 0) {
      return new Response(JSON.stringify({ polled: 0, events: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken = await getDriveAccessToken();
    let totalEvents = 0;
    const errors: Array<{ watchId: string; error: string }> = [];

    for (const watch of watches) {
      try {
        const lastSeen = watch.last_seen_time as string;
        const lastSeenIso = new Date(lastSeen).toISOString();
        // Drive uploads often preserve the file's original mtime, so a brand
        // new file can have modifiedTime older than the watch. We OR with
        // createdTime to catch those, and advance the cursor to request-start
        // time so the next tick picks up anything that landed after this one.
        const requestStart = new Date().toISOString();
        const q = `'${watch.folder_id}' in parents and (createdTime > '${lastSeenIso}' or modifiedTime > '${lastSeenIso}')`;

        const driveRes = await fetch(
          "https://www.googleapis.com/drive/v3/files?" + new URLSearchParams({
            q,
            fields: "files(id,name,mimeType,webViewLink,createdTime,modifiedTime,trashed,parents,lastModifyingUser(emailAddress,displayName,permissionId))",
            orderBy: "createdTime",
            pageSize: "200",
            supportsAllDrives: "true",
            includeItemsFromAllDrives: "true",
          }),
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        const driveBody = await driveRes.json();
        if (!driveRes.ok) {
          throw new Error(`Drive list failed: ${driveBody.error?.message || driveRes.status}`);
        }

        const files: DriveFile[] = driveBody.files || [];

        for (const f of files) {
          const eventType: "added" | "modified" | "trashed" =
            f.trashed ? "trashed"
            : (f.createdTime && Date.parse(f.createdTime) > Date.parse(lastSeen)) ? "added"
            : "modified";

          const { error: upsertErr } = await admin.from("drive_events").upsert(
            {
              watch_id: watch.id,
              drive_file_id: f.id,
              file_name: f.name ?? null,
              mime_type: f.mimeType ?? null,
              parent_folder_id: f.parents?.[0] ?? watch.folder_id,
              web_view_link: f.webViewLink ?? null,
              created_time: f.createdTime ?? null,
              modified_time: f.modifiedTime ?? null,
              event_type: eventType,
              uploader_email: f.lastModifyingUser?.emailAddress ?? null,
              uploader_display_name: f.lastModifyingUser?.displayName ?? null,
              uploader_permission_id: f.lastModifyingUser?.permissionId ?? null,
              payload: f as unknown as Record<string, unknown>,
            },
            { onConflict: "watch_id,drive_file_id,event_type", ignoreDuplicates: true },
          );
          if (!upsertErr) totalEvents += 1;
        }

        await admin
          .from("drive_watches")
          .update({
            last_seen_time: requestStart,
            updated_at: new Date().toISOString(),
          })
          .eq("id", watch.id);
      } catch (err) {
        errors.push({ watchId: watch.id, error: (err as Error).message });
      }
    }

    return new Response(JSON.stringify({ polled: watches.length, events: totalEvents, errors }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
