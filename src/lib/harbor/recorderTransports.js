// Harbor recorder transports — the two upload paths behind one engine seam.
//
// The recorder engine (recorder.js) is transport-agnostic. These adapters
// implement its transport contract:
//
//   * STAFF — logged-in producers. Direct supabase-js: harbor_tracks writes
//     under staff RLS, chunk uploads straight to the private
//     harbor-recordings bucket under the storage policies added in
//     20260723170000_harbor_phase2_recording.sql.
//
//   * GUEST — no auth session. Everything rides the harbor-track edge
//     function with the session guest_token as credential: track row create,
//     batched signed upload URLs (the chunk PUTs go straight to storage with
//     the signed token — no edge hop per chunk), progress pings, finalize.
//
// Both write the same chunk layout (extension follows the container:
// .mp4 for MediaRecorder mp4, .webm otherwise):
//   <session_id>/<participant_id>/<track_id>/<chunk_index 6-padded>.<ext>

import { supabase } from '../../supabaseClient';
import { chunkPath, containerExt, HARBOR_RECORDINGS_BUCKET } from './recorder';

const TRACK_URL = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/harbor-track`;

// Batch size mirrors MAX_URLS_PER_BATCH in supabase/functions/harbor-track.
const URL_BATCH_SIZE = 60;
// Refill in the background when fewer than this many URLs remain ahead.
const URL_LOW_WATER = 10;

/** Store 'video/webm' rather than 'video/webm;codecs=vp9,opus'. */
function baseMime(mimeType) {
  return (mimeType || 'video/webm').split(';')[0];
}

// ── Staff: direct supabase-js under RLS ────────────────────────
export function createStaffRecorderTransport({ sessionId, participantId }) {
  let trackId = null;
  let storagePrefix = null;

  return {
    async createTrack({ kind, mimeType }) {
      trackId = crypto.randomUUID();
      storagePrefix = `${sessionId}/${participantId}/${trackId}`;
      const { error } = await supabase.from('harbor_tracks').insert({
        id: trackId,
        session_id: sessionId,
        participant_id: participantId,
        kind,
        mime_type: mimeType,
        storage_prefix: storagePrefix,
        status: 'recording',
      });
      if (error) throw error;
      return { trackId, storagePrefix };
    },

    async uploadChunk(index, blob, mimeType) {
      const { error } = await supabase.storage
        .from(HARBOR_RECORDINGS_BUCKET)
        .upload(chunkPath(storagePrefix, index, containerExt(mimeType)), blob, {
          contentType: baseMime(mimeType),
          upsert: true, // retries of a half-landed chunk must be able to re-PUT
        });
      if (error) throw error;
    },

    async progress({ bytesUploaded, chunkCount }) {
      const { error } = await supabase
        .from('harbor_tracks')
        .update({ bytes_uploaded: bytesUploaded, chunk_count: chunkCount })
        .eq('id', trackId)
        .in('status', ['recording', 'uploading']); // never clobber a finalized row
      if (error) throw error;
    },

    async finalize({ chunkCount, bytes, durationMs, status }) {
      const { error } = await supabase
        .from('harbor_tracks')
        .update({
          status,
          chunk_count: chunkCount,
          bytes_uploaded: bytes,
          duration_ms: durationMs,
          completed_at: new Date().toISOString(),
        })
        .eq('id', trackId);
      if (error) throw error;
    },
  };
}

// ── Guest: harbor-track edge function, token = credential ──────
export function createGuestRecorderTransport({ token, participantId }) {
  let trackId = null;
  const urlPool = new Map(); // chunk index → signed upload URL
  let highestFetched = -1;
  let refillPromise = null;

  async function call(action, extra = {}) {
    const res = await fetch(TRACK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, token, participant_id: participantId, ...extra }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(body.error || `harbor-track ${action} failed (HTTP ${res.status})`);
      err.status = res.status;
      throw err;
    }
    return body;
  }

  /** Fetch a batch of signed URLs starting at fromIndex (single-flight). */
  function refill(fromIndex) {
    if (refillPromise) return refillPromise;
    refillPromise = call('upload-urls', {
      track_id: trackId,
      from_index: fromIndex,
      count: URL_BATCH_SIZE,
    })
      .then((body) => {
        for (const entry of body.urls || []) {
          urlPool.set(entry.index, entry.url);
          if (entry.index > highestFetched) highestFetched = entry.index;
        }
      })
      .finally(() => {
        refillPromise = null;
      });
    return refillPromise;
  }

  return {
    async createTrack({ kind, mimeType }) {
      const body = await call('create', { kind, mime_type: mimeType });
      trackId = body.track_id;
      return { trackId: body.track_id, storagePrefix: body.storage_prefix };
    },

    async uploadChunk(index, blob, mimeType) {
      if (!urlPool.has(index)) await refill(index);
      const url = urlPool.get(index);
      if (!url) throw new Error(`No signed URL for chunk ${index}`);

      // Keep the pool topped up in the background so sequential uploads
      // rarely wait on an edge round-trip.
      if (highestFetched - index < URL_LOW_WATER && !refillPromise) {
        refill(highestFetched + 1).catch(() => {}); // next miss retries it
      }

      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'content-type': baseMime(mimeType), 'x-upsert': 'true' },
        body: blob,
      });
      if (!res.ok) {
        // 4xx usually means the signed token expired (they live ~2h) or was
        // consumed by a half-landed retry — drop it so the next attempt
        // fetches a fresh one.
        if (res.status >= 400 && res.status < 500) urlPool.delete(index);
        throw new Error(`Chunk ${index} upload failed (HTTP ${res.status})`);
      }
      urlPool.delete(index);
    },

    async progress({ bytesUploaded, chunkCount }) {
      await call('progress', {
        track_id: trackId,
        bytes_uploaded: bytesUploaded,
        chunk_count: chunkCount,
      });
    },

    async finalize({ chunkCount, bytes, durationMs, status }) {
      await call('finalize', {
        track_id: trackId,
        chunk_count: chunkCount,
        bytes,
        duration_ms: durationMs,
        status,
      });
    },
  };
}
