// Send a direct message as the caller — used by the Mayday Assistant's approved-draft
// sender. Admin-only; the caller must be a participant in the conversation.
//
//   POST /functions/v1/assistant-send-dm  { conversation_id, content }
//
// Deploy: supabase functions deploy assistant-send-dm --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getUserFromJwt, getAdminClient } from "../shared/workflow-engine.ts";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const auth = await getUserFromJwt(req);
  if (!auth) return json({ error: "Unauthorized" }, 401);
  if (!auth.isAdmin) return json({ error: "Admin only" }, 403);

  let conversationId = "", content = "";
  try {
    const body = await req.json();
    conversationId = String(body?.conversation_id ?? "");
    content = String(body?.content ?? "").trim();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (!conversationId || !content || content.length > 4000) {
    return json({ error: "conversation_id and content required" }, 400);
  }

  const admin = getAdminClient();
  const { data: member } = await admin
    .from("conversation_participants")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("user_id", auth.userId)
    .limit(1);
  if (!member?.length) return json({ error: "Not a participant" }, 403);

  const { data, error } = await admin
    .from("direct_messages")
    .insert({ conversation_id: conversationId, user_id: auth.userId, content })
    .select("id")
    .single();
  if (error) {
    console.error("assistant-send-dm insert failed:", error);
    return json({ error: "Insert failed" }, 500);
  }
  return json({ ok: true, id: data.id });
});
