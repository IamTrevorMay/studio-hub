// harbor-join — public guest entry point for Harbor sessions.
//
// Guests have no login: the session's guest_token IS the credential. This
// function validates the token, registers a participant row with the service
// role (harbor_* tables have NO anon RLS policies), and returns the signaling
// channel name. The channel name embeds a secret derived from guest_token so
// it can't be guessed from a session id alone. It also handles guest leave
// (stamping left_at), since guests can't touch the table directly.
//
// Guests connect to Supabase Realtime with the app's public anon key and use
// broadcast + presence only — no DB reads — so no extra realtime auth info is
// needed beyond the channel name returned here.
//
// Auth posture: bad/expired tokens → 404 with a generic body (no enumeration
// hints). Ended sessions look identical to nonexistent ones.
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

// Producer + 3 guests. Mirrors HARBOR_MAX_PARTICIPANTS in src/lib/harbor/mesh.js.
const MAX_PARTICIPANTS = 4;

// Must match deriveHarborChannel() in src/lib/harbor/signaling.js:
// sha256(guest_token) → hex → first 16 chars.
async function channelSecret(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
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
      .select("id, title, status, guest_token")
      .eq("guest_token", token)
      .maybeSingle();
    if (sessionErr) throw sessionErr;
    if (!session || session.status === "ended") return jsonResp({ error: "Not found" }, 404);

    // ── leave: guests can't stamp their own left_at under RLS ──
    if (body.action === "leave") {
      const participantId = typeof body.participant_id === "string" ? body.participant_id : "";
      if (participantId) {
        await admin
          .from("harbor_participants")
          .update({ left_at: new Date().toISOString() })
          .eq("id", participantId)
          .eq("session_id", session.id)
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

    // Capacity: count participants still in the call (left_at null).
    const { count, error: countErr } = await admin
      .from("harbor_participants")
      .select("id", { count: "exact", head: true })
      .eq("session_id", session.id)
      .is("left_at", null);
    if (countErr) throw countErr;
    if ((count ?? 0) >= MAX_PARTICIPANTS) return jsonResp({ error: "Session is full" }, 409);

    // state 'admitted' for Phase 1 — the Phase 3 green-room flow will insert
    // as 'lobby' and add a producer admit action instead.
    const { data: participant, error: insertErr } = await admin
      .from("harbor_participants")
      .insert({
        session_id: session.id,
        display_name: displayName,
        role: "guest",
        state: "admitted",
        client_id: clientId,
      })
      .select("id")
      .single();
    if (insertErr) throw insertErr;

    const secret = await channelSecret(session.guest_token);
    return jsonResp({
      session: { id: session.id, title: session.title, status: session.status },
      participant_id: participant.id,
      channel: `harbor:${session.id}:${secret}`,
    });
  } catch (err) {
    console.error("harbor-join error:", err);
    // Generic body — this endpoint faces the open internet.
    return jsonResp({ error: "Internal error" }, 500);
  }
});
