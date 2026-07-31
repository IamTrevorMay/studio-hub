// harbor-join — public guest entry point for Harbor sessions.
//
// Guests have no login: the session's guest_token IS the credential. This
// function validates the token, registers a participant row with the service
// role (harbor_* tables have NO anon RLS policies), and returns the signaling
// channel name. The channel name embeds the first 16 chars of the session's
// channel_secret — a separate column from guest_token, so rotating the guest
// link (Phase 3) never moves the live channel or disturbs connected peers.
// Mirrors harborChannelName() in src/lib/harbor/signaling.js — keep in sync.
//
// Phase 3 green room: fresh guests are inserted with state 'lobby' and wait
// for a producer admit (a staff-side RLS update + targeted 'admit' signal).
// Re-join: the client may pass participant_id + resume_key (HarborJoin keeps
// both in sessionStorage) — if they match a non-removed row in this session,
// that row is reactivated with its state preserved, so an admitted guest who
// refreshes skips the lobby. Removed rows and wrong/missing resume_keys get
// the uniform 404.
//
// resume_key (Phase 3b) is the per-participant secret: participant_id is
// broadcast in channel presence (the producer's admit/remove UI needs the
// clientId → row mapping), so the pid must NOT be a credential on its own —
// without the key, a lobby lurker who read an admitted guest's pid from
// presence could re-join as them and skip the green room, or drive
// harbor-track against their recording. The key is returned ONLY in this
// function's direct response to the joining client and must never appear in
// presence meta, broadcasts, or any channel-visible payload.
//
// Also handles guest leave (stamping left_at), since guests can't touch the
// table directly. Leave requires the resume_key too (a presence-read pid can
// no longer grief another guest's left_at); mismatches no-op silently —
// leave is a fire-and-forget beacon, not an oracle.
//
// Auth posture: bad/expired tokens → 404 with a generic body (no enumeration
// hints). Ended sessions and removed participants look identical to
// nonexistent ones.
// Deploy: supabase functions deploy harbor-join --no-verify-jwt

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

// Seat cap is per-session (harbor_sessions.max_participants): 4 for a
// recording session, more for a meeting. Fall back to 4 for legacy rows.
// Lobby guests occupy a seat (accepted for v1). Mirrors the mesh cap in
// src/lib/harbor/mesh.js.
const DEFAULT_MAX_PARTICIPANTS = 4;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Must match harborChannelName() in src/lib/harbor/signaling.js:
// first 16 chars of harbor_sessions.channel_secret.
function channelName(sessionId: string, channelSecret: string): string {
  return `harbor:${sessionId}:${channelSecret.slice(0, 16)}`;
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

    const token = typeof body.token === "string" ? body.token.trim() : "";
    // Tokens are 64 hex chars; a length gate keeps junk out of the query.
    if (!token || token.length > 128) return jsonResp({ error: "Not found" }, 404);

    const { data: session, error: sessionErr } = await admin
      .from("harbor_sessions")
      .select("id, title, status, channel_secret, mode, max_participants, record_enabled")
      .eq("guest_token", token)
      .maybeSingle();
    if (sessionErr) throw sessionErr;
    if (!session || session.status === "ended") return jsonResp({ error: "Not found" }, 404);

    const isMeeting = session.mode === "meeting";
    const maxParticipants = session.max_participants && session.max_participants > 0
      ? session.max_participants
      : DEFAULT_MAX_PARTICIPANTS;
    // Recording sessions always record on demand; meetings gate on the host's
    // opt-in. Guests use this to show/hide recording UI.
    const recordEnabled = isMeeting ? !!session.record_enabled : true;

    const channel = channelName(session.id, session.channel_secret);
    const sessionOut = {
      id: session.id,
      title: session.title,
      status: session.status,
      mode: session.mode || "recording",
      max_participants: maxParticipants,
      record_enabled: recordEnabled,
    };

    // resume_key rides re-join and leave. 64 hex chars; length gate keeps
    // junk out of the queries.
    const resumeKey =
      typeof body.resume_key === "string" && body.resume_key.length <= 128
        ? body.resume_key.trim()
        : "";

    // ── leave: guests can't stamp their own left_at under RLS ──
    if (body.action === "leave") {
      const participantId = typeof body.participant_id === "string" ? body.participant_id : "";
      if (participantId && resumeKey) {
        // resume_key in the WHERE: a mismatch silently updates zero rows.
        await admin
          .from("harbor_participants")
          .update({ left_at: new Date().toISOString() })
          .eq("id", participantId)
          .eq("session_id", session.id)
          .eq("resume_key", resumeKey)
          .is("left_at", null);
      }
      return jsonResp({ ok: true });
    }

    // ── join ───────────────────────────────────────────────────
    const displayName = typeof body.display_name === "string"
      ? body.display_name.trim().slice(0, 80)
      : "";
    const clientId = typeof body.client_id === "string"
      ? body.client_id.trim().slice(0, 64)
      : "";
    if (!displayName || !clientId) {
      return jsonResp({ error: "display_name and client_id are required" }, 400);
    }

    /** Count seats in use: rows still in the call, lobby included, removed excluded. */
    async function activeCount(): Promise<number> {
      const { count, error: countErr } = await admin
        .from("harbor_participants")
        .select("id", { count: "exact", head: true })
        .eq("session_id", session!.id)
        .is("left_at", null)
        .neq("state", "removed");
      if (countErr) throw countErr;
      return count ?? 0;
    }

    // ── re-join by participant_id + resume_key (refresh survival) ──
    // Malformed ids are treated as absent (a fresh join) — leniency only
    // helps guests with stale/corrupt storage. But a WELL-FORMED pid must
    // carry the matching resume_key: participant_id is visible to the whole
    // channel via presence, so on its own it proves nothing. Wrong/missing
    // key → hard uniform 404, NOT a fresh-join fallthrough (a hijack attempt
    // should not be silently converted into a lobby seat).
    const rejoinId = typeof body.participant_id === "string" && UUID_RE.test(body.participant_id.trim())
      ? body.participant_id.trim()
      : "";
    if (rejoinId) {
      const { data: existing, error: existingErr } = await admin
        .from("harbor_participants")
        .select("id, state, left_at, resume_key")
        .eq("id", rejoinId)
        .eq("session_id", session.id)
        .maybeSingle();
      if (existingErr) throw existingErr;
      if (existing) {
        // resume_key gate first: no state/left_at behavior is observable
        // without the key. Then: a removed participant never re-enters.
        if (!resumeKey || existing.resume_key !== resumeKey) {
          return jsonResp({ error: "Not found" }, 404);
        }
        if (existing.state === "removed") return jsonResp({ error: "Not found" }, 404);
        // Reactivating a left row takes a seat back — recheck capacity.
        // (A row with left_at null is already counted; skip the check.)
        if (existing.left_at && (await activeCount()) >= maxParticipants) {
          return jsonResp({ error: "Session is full" }, 409);
        }
        const { error: updateErr } = await admin
          .from("harbor_participants")
          .update({ client_id: clientId, display_name: displayName, left_at: null })
          .eq("id", existing.id);
        if (updateErr) throw updateErr;
        return jsonResp({
          session: sessionOut,
          participant_id: existing.id,
          state: existing.state, // preserved: an admitted guest skips the lobby
          resume_key: existing.resume_key,
          channel,
        });
      }
      // No such row in this session (stale storage) — fall through to a fresh join.
    }

    // ── fresh join ─────────────────────────────────────────────
    // Recording sessions park guests in the green room; meetings admit them
    // straight in (staff-plus-guest calls skip the producer-admit dance).
    if ((await activeCount()) >= maxParticipants) {
      return jsonResp({ error: "Session is full" }, 409);
    }

    const initialState = isMeeting ? "admitted" : "lobby";
    const { data: participant, error: insertErr } = await admin
      .from("harbor_participants")
      .insert({
        session_id: session.id,
        display_name: displayName,
        role: "guest",
        state: initialState,
        client_id: clientId,
      })
      .select("id, resume_key") // resume_key comes from the column default
      .single();
    if (insertErr) throw insertErr;

    return jsonResp({
      session: sessionOut,
      participant_id: participant.id,
      state: initialState,
      resume_key: participant.resume_key,
      channel,
    });
  } catch (err) {
    console.error("harbor-join error:", err);
    // Generic body — this endpoint faces the open internet.
    return jsonResp({ error: "Internal error" }, 500);
  }
});
