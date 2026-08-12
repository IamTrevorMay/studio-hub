// Messages feed for the Mayday Assistant ("Gerald") daemon: the caller's DM
// conversations plus channel messages that @mention them, since a cursor.
//
//   POST /functions/v1/assistant-messages  { since?: ISO timestamp, limit?: number }
//
// Admin-only (same gate as assistant-summary). Returns
//   { now, caller_id, dms: [...], mentions: [...] }
// ordered oldest-first, capped at `limit` (default/max 200) per list.
//
// Deploy: supabase functions deploy assistant-messages --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getUserFromJwt, getAdminClient } from "../shared/workflow-engine.ts";

function resp(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Access-Control-Allow-Origin": "https://assist.mmcreate.io",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Content-Type": "application/json",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return resp(null);
  if (req.method !== "POST") return resp({ error: "Method not allowed" }, 405);

  const auth = await getUserFromJwt(req);
  if (!auth) return resp({ error: "Unauthorized" }, 401);
  // Strict admin: this endpoint was admin-only before isAdmin became
  // admin-tier, and directors are not meant to reach it.
  if (!auth.isStrictAdmin) return resp({ error: "Admin only" }, 403);

  let since: string | null = null;
  let limit = 200;
  try {
    const body = await req.json();
    since = body?.since ?? null;
    limit = Math.min(Number(body?.limit) || 200, 200);
  } catch { /* empty body is fine */ }

  const admin = getAdminClient();
  const nowIso = new Date().toISOString();

  try {
    // Conversations the caller participates in
    const { data: parts } = await admin
      .from("conversation_participants")
      .select("conversation_id")
      .eq("user_id", auth.userId);
    const convIds = (parts ?? []).map((p) => p.conversation_id);

    let dmQ = admin
      .from("direct_messages")
      .select("id, conversation_id, user_id, content, created_at, "
        + "profiles(full_name), conversations(name, is_group)")
      .in("conversation_id", convIds.length ? convIds : ["00000000-0000-0000-0000-000000000000"])
      .order("created_at", { ascending: true })
      .limit(limit);
    if (since) dmQ = dmQ.gt("created_at", since);

    let mentionQ = admin
      .from("channel_messages")
      .select("id, channel_id, user_id, content, created_at, "
        + "profiles(full_name), channels(name)")
      .contains("mentions", [auth.userId])
      .order("created_at", { ascending: true })
      .limit(limit);
    if (since) mentionQ = mentionQ.gt("created_at", since);

    // Reactions land on EXISTING rows, so a cursor on created_at never re-sees
    // them. Return recently-created messages that carry any reactions as a
    // separate list — the daemon dedupes per (message, emoji, reactor), so
    // re-sending the same window is idempotent. 7-day lookback: a 👍 on an
    // older message than that is vanishingly rare for open asks.
    const reactedSince = new Date(Date.now() - 7 * 864e5).toISOString();
    const reactedQ = admin
      .from("direct_messages")
      .select("id, conversation_id, user_id, content, created_at, reactions, "
        + "profiles(full_name), conversations(name, is_group)")
      .in("conversation_id", convIds.length ? convIds : ["00000000-0000-0000-0000-000000000000"])
      .not("reactions", "eq", "{}")
      .not("reactions", "is", null)
      .gte("created_at", reactedSince)
      .order("created_at", { ascending: true })
      .limit(limit);

    const [dms, mentions, reacted] = await Promise.all([dmQ, mentionQ, reactedQ]);
    if (dms.error) throw dms.error;
    if (mentions.error) throw mentions.error;
    if (reacted.error) throw reacted.error;

    type Row = {
      id: string; user_id: string; content: string; created_at: string;
      conversation_id?: string; channel_id?: string;
      reactions?: Record<string, string[]> | null;
      profiles: { full_name: string } | null;
      conversations?: { name: string | null; is_group: boolean } | null;
      channels?: { name: string | null } | null;
    };

    return resp({
      now: nowIso,
      caller_id: auth.userId,
      dms: ((dms.data ?? []) as unknown as Row[]).map((m) => ({
        id: m.id,
        conversation_id: m.conversation_id,
        sender_id: m.user_id,
        sender: m.profiles?.full_name ?? null,
        conversation: m.conversations?.name ?? null,
        is_group: m.conversations?.is_group ?? false,
        content: m.content,
        created_at: m.created_at,
      })),
      mentions: ((mentions.data ?? []) as unknown as Row[]).map((m) => ({
        id: m.id,
        channel_id: m.channel_id,
        sender_id: m.user_id,
        sender: m.profiles?.full_name ?? null,
        channel: m.channels?.name ?? null,
        content: m.content,
        created_at: m.created_at,
      })),
      reacted: ((reacted.data ?? []) as unknown as Row[]).map((m) => ({
        id: m.id,
        conversation_id: m.conversation_id,
        message_owner_id: m.user_id,
        conversation: m.conversations?.name ?? null,
        is_group: m.conversations?.is_group ?? false,
        content: m.content,
        created_at: m.created_at,
        reactions: m.reactions ?? {},
      })),
    });
  } catch (err) {
    console.error("assistant-messages error:", err);
    return resp({ error: "Internal error" }, 500);
  }
});
