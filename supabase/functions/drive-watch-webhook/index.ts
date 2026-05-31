// supabase/functions/drive-watch-webhook/index.ts
// Receives Drive `files.watch` push notifications. Google sends:
//   X-Goog-Channel-Id        — uuid we generated on register
//   X-Goog-Channel-Token     — per-channel secret we stored
//   X-Goog-Resource-Id       — Drive's identifier for the watched resource
//   X-Goog-Resource-State    — sync | add | remove | update | trash | untrash | change
//   X-Goog-Message-Number    — monotonic counter (notification ordering)
//
// The ping body is empty. We look up the matching watch row, then call
// files.list scoped to the folder with createdTime/modifiedTime > last_seen
// to learn which file actually changed (Drive does not include this in the
// notification itself), and insert a row into drive_events per file.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
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
  if (req.method !== "POST") {
    return new Response("ok", { status: 200 });
  }

  // Drive expects 2xx within 30s. Any non-2xx or timeout causes Google to
  // retry the notification with exponential backoff, which still works but
  // adds latency, so we keep the handler tight.
  try {
    const channelId = req.headers.get("X-Goog-Channel-Id");
    const token = req.headers.get("X-Goog-Channel-Token");
    const resourceState = req.headers.get("X-Goog-Resource-State");

    if (!channelId || !token) {
      // Not a Drive ping. Ignore silently rather than 4xx — Google will retry.
      return new Response("ok", { status: 200 });
    }

    // Drive sends a sync ping immediately after watch registration. Ack it
    // without touching the database; there's nothing new to record yet.
    if (resourceState === "sync") {
      return new Response("ok", { status: 200 });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: watch, error: watchErr } = await admin
      .from("drive_watches")
      .select("*")
      .eq("channel_id", channelId)
      .is("stopped_at", null)
      .maybeSingle();
    if (watchErr || !watch) {
      // Channel is unknown or already stopped on our side. Ack so Google
      // does not keep retrying.
      return new Response("ok", { status: 200 });
    }
    if (watch.webhook_token !== token) {
      return new Response("forbidden", { status: 403 });
    }

    const accessToken = await getDriveAccessToken();

    // Pull every file in the folder modified since last_seen_time. We use
    // modifiedTime (not createdTime) so we also surface trashes and renames.
    const lastSeen = watch.last_seen_time as string;
    const q = `'${watch.folder_id}' in parents and modifiedTime > '${new Date(lastSeen).toISOString()}'`;
    const driveRes = await fetch(
      "https://www.googleapis.com/drive/v3/files?" + new URLSearchParams({
        q,
        fields: "files(id,name,mimeType,webViewLink,createdTime,modifiedTime,trashed,parents,lastModifyingUser(emailAddress,displayName,permissionId))",
        orderBy: "modifiedTime",
        pageSize: "200",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
      }),
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const driveBody = await driveRes.json();
    if (!driveRes.ok) {
      // Don't ack — return 500 so Google retries. Most likely transient.
      throw new Error(`Drive list failed: ${driveBody.error?.message || driveRes.status}`);
    }

    const files: DriveFile[] = driveBody.files || [];
    let maxModified = new Date(lastSeen).getTime();

    for (const f of files) {
      const modifiedMs = f.modifiedTime ? Date.parse(f.modifiedTime) : 0;
      if (modifiedMs > maxModified) maxModified = modifiedMs;

      const eventType: "added" | "modified" | "trashed" =
        f.trashed ? "trashed"
        : (f.createdTime && Date.parse(f.createdTime) > Date.parse(lastSeen)) ? "added"
        : "modified";

      await admin.from("drive_events").upsert(
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
    }

    await admin
      .from("drive_watches")
      .update({
        last_seen_time: new Date(maxModified).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", watch.id);

    return new Response("ok", { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
