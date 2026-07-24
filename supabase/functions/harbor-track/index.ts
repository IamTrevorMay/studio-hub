// harbor-track — guest-side recording API for Harbor Phase 2.
//
// Guests record locally (MediaRecorder) and progressively upload ~5s chunks
// to the PRIVATE harbor-recordings bucket. They have no auth session and the
// bucket has zero anon policies, so every guest operation flows through here:
// the session guest_token is the credential (mirrors harbor-join's posture —
// uniform 404s, length gates, generic errors, open CORS).
//
// Actions (POST { action, token, participant_id, ... }):
//   create      { kind, mime_type }            → insert harbor_tracks row
//                 (status 'recording'), returns { track_id, storage_prefix }
//   upload-urls { track_id, from_index, count } → batch of signed upload URLs
//                 for chunk paths (count capped — one edge call per ~60
//                 chunks instead of one per 5s chunk)
//   progress    { track_id, bytes_uploaded, chunk_count } → row update so the
//                 producer UI can show upload health (client throttles ~15s)
//   finalize    { track_id, chunk_count, bytes, duration_ms, status } →
//                 marks the track complete|failed, stamps completed_at
//
// Sessions: create requires a not-ended session. upload-urls / progress /
// finalize stay valid for ENDED_GRACE_MS after the session ends — uploads
// outlive the call (guest closes the laptop; the flush keeps going).
//
// Chunk layout (Phase 4 NAS archival walks this tree, then purges):
//   <session_id>/<participant_id>/<track_id>/<chunk_index 6-padded>.webm
//
// Staff never call this — they upload/write directly under RLS with the same
// recorder engine and a different transport (src/lib/harbor/recorderTransports.js).
// Deploy: supabase functions deploy harbor-track --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResp(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const BUCKET = "harbor-recordings";
const MAX_URLS_PER_BATCH = 60; // ~5 min of 5s chunks per edge call
const MAX_CHUNK_INDEX = 100_000; // ~139h of 5s chunks — sanity ceiling
const ENDED_GRACE_MS = 6 * 60 * 60 * 1000; // uploads allowed 6h past session end

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Extension follows the recording container — mirrors containerExt()/chunkPath()
// in src/lib/harbor/recorder.js. Keep in sync.
function chunkPath(prefix: string, index: number, mimeType: string | null): string {
  const ext = (mimeType || "").startsWith("video/mp4") ? "mp4" : "webm";
  return `${prefix}/${String(index).padStart(6, "0")}.${ext}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResp({ error: "Method not allowed" }, 405);

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return jsonResp({ error: "Bad request" }, 400);

    const action = typeof body.action === "string" ? body.action : "";
    const token = typeof body.token === "string" ? body.token.trim() : "";
    const participantId = typeof body.participant_id === "string" ? body.participant_id.trim() : "";
    // Length/format gates keep junk out of the queries; bad credentials are
    // indistinguishable from missing sessions (uniform 404).
    if (!token || token.length > 128) return jsonResp({ error: "Not found" }, 404);
    if (!UUID_RE.test(participantId)) return jsonResp({ error: "Not found" }, 404);

    const { data: session, error: sessionErr } = await admin
      .from("harbor_sessions")
      .select("id, status, ended_at")
      .eq("guest_token", token)
      .maybeSingle();
    if (sessionErr) throw sessionErr;
    if (!session) return jsonResp({ error: "Not found" }, 404);

    if (session.status === "ended") {
      // New recordings can't start after the end; in-flight uploads get grace.
      if (action === "create") return jsonResp({ error: "Not found" }, 404);
      const endedAt = session.ended_at ? new Date(session.ended_at).getTime() : Date.now();
      if (Date.now() - endedAt > ENDED_GRACE_MS) return jsonResp({ error: "Not found" }, 404);
    }

    const { data: participant, error: participantErr } = await admin
      .from("harbor_participants")
      .select("id, state")
      .eq("id", participantId)
      .eq("session_id", session.id)
      .maybeSingle();
    if (participantErr) throw participantErr;
    if (!participant || participant.state === "removed") {
      return jsonResp({ error: "Not found" }, 404);
    }

    // ── create ─────────────────────────────────────────────────
    if (action === "create") {
      const kind = body.kind === "audio" ? "audio" : "video";
      const mimeType = typeof body.mime_type === "string" ? body.mime_type.slice(0, 100) : null;

      const trackId = crypto.randomUUID();
      const storagePrefix = `${session.id}/${participant.id}/${trackId}`;
      const { error: insertErr } = await admin.from("harbor_tracks").insert({
        id: trackId,
        session_id: session.id,
        participant_id: participant.id,
        kind,
        mime_type: mimeType,
        storage_prefix: storagePrefix,
        status: "recording",
      });
      if (insertErr) throw insertErr;

      return jsonResp({ track_id: trackId, storage_prefix: storagePrefix });
    }

    // ── everything else operates on an existing track ──────────
    const trackId = typeof body.track_id === "string" ? body.track_id.trim() : "";
    if (!UUID_RE.test(trackId)) return jsonResp({ error: "Not found" }, 404);

    const { data: track, error: trackErr } = await admin
      .from("harbor_tracks")
      .select("id, storage_prefix, status, mime_type")
      .eq("id", trackId)
      .eq("session_id", session.id)
      .eq("participant_id", participant.id) // a track is only its owner's
      .maybeSingle();
    if (trackErr) throw trackErr;
    if (!track || !track.storage_prefix) return jsonResp({ error: "Not found" }, 404);

    // ── upload-urls ────────────────────────────────────────────
    if (action === "upload-urls") {
      const fromIndex = Number.isInteger(body.from_index) ? body.from_index : -1;
      const count = Number.isInteger(body.count)
        ? Math.min(Math.max(body.count, 1), MAX_URLS_PER_BATCH)
        : MAX_URLS_PER_BATCH;
      if (fromIndex < 0 || fromIndex > MAX_CHUNK_INDEX) {
        return jsonResp({ error: "Bad request" }, 400);
      }

      // upsert: a retry of a chunk that half-landed must be able to re-PUT.
      const urls = await Promise.all(
        Array.from({ length: count }, async (_, i) => {
          const index = fromIndex + i;
          const path = chunkPath(track.storage_prefix, index, track.mime_type);
          const { data, error } = await admin.storage
            .from(BUCKET)
            .createSignedUploadUrl(path, { upsert: true });
          if (error) throw error;
          return { index, path, url: data.signedUrl, token: data.token };
        }),
      );

      return jsonResp({ urls });
    }

    // ── progress ───────────────────────────────────────────────
    if (action === "progress") {
      const bytesUploaded = Number.isFinite(body.bytes_uploaded)
        ? Math.max(0, Math.min(Math.round(body.bytes_uploaded), 1e12))
        : null;
      const chunkCount = Number.isInteger(body.chunk_count)
        ? Math.max(0, Math.min(body.chunk_count, MAX_CHUNK_INDEX))
        : null;
      if (bytesUploaded === null && chunkCount === null) {
        return jsonResp({ error: "Bad request" }, 400);
      }

      const patch: Record<string, unknown> = {};
      if (bytesUploaded !== null) patch.bytes_uploaded = bytesUploaded;
      if (chunkCount !== null) patch.chunk_count = chunkCount;
      // Never clobber a finalized row with a late progress ping.
      const { error: updateErr } = await admin
        .from("harbor_tracks")
        .update(patch)
        .eq("id", track.id)
        .in("status", ["recording", "uploading"]);
      if (updateErr) throw updateErr;

      return jsonResp({ ok: true });
    }

    // ── finalize ───────────────────────────────────────────────
    if (action === "finalize") {
      const status = body.status === "failed" ? "failed" : body.status === "complete" ? "complete" : null;
      if (!status) return jsonResp({ error: "Bad request" }, 400);

      const patch: Record<string, unknown> = { status, completed_at: new Date().toISOString() };
      if (Number.isInteger(body.chunk_count)) {
        patch.chunk_count = Math.max(0, Math.min(body.chunk_count, MAX_CHUNK_INDEX));
      }
      if (Number.isFinite(body.bytes)) {
        patch.bytes_uploaded = Math.max(0, Math.min(Math.round(body.bytes), 1e12));
      }
      if (Number.isFinite(body.duration_ms)) {
        patch.duration_ms = Math.max(0, Math.min(Math.round(body.duration_ms), 1e10));
      }

      const { error: updateErr } = await admin
        .from("harbor_tracks")
        .update(patch)
        .eq("id", track.id);
      if (updateErr) throw updateErr;

      return jsonResp({ ok: true });
    }

    return jsonResp({ error: "Bad request" }, 400);
  } catch (err) {
    console.error("harbor-track error:", err);
    // Generic body — this endpoint faces the open internet.
    return jsonResp({ error: "Internal error" }, 500);
  }
});
