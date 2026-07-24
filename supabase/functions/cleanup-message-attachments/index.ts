// cleanup-message-attachments
// Deletes a message row AND its image objects from the `message-attachments`
// bucket, with no orphans. Authorization reuses the table's own RLS: the row is
// deleted through a caller-scoped client, so the existing delete policy decides
// (DMs = owner only; channel_messages = owner or admin). Only if that delete
// succeeds does the service-role client remove the storage objects — which it
// must, because a channel admin deleting another user's image can't satisfy the
// per-user storage DELETE policy from the client.
//
// Body: { table: 'direct_messages' | 'channel_messages', message_id: string }
// Auth: caller JWT (Authorization: Bearer <user token>), validated internally.
// Deploy: supabase functions deploy cleanup-message-attachments --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const BUCKET = "message-attachments";
const ALLOWED_TABLES = ["direct_messages", "channel_messages"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResp(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

// Extract the in-bucket object path from a public storage URL.
function pathFromPublicUrl(url: string): string | null {
  const marker = `/object/public/${BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  try {
    return decodeURIComponent(url.slice(idx + marker.length).split("?")[0]);
  } catch {
    return url.slice(idx + marker.length).split("?")[0];
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResp({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResp({ error: "Unauthorized" }, 401);

  // Caller-scoped client: DB writes through this honor the table's RLS.
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) return jsonResp({ error: "Unauthorized" }, 401);

  let body: { table?: string; message_id?: string };
  try { body = await req.json(); } catch { return jsonResp({ error: "Invalid JSON" }, 400); }

  const { table, message_id } = body;
  if (!table || !ALLOWED_TABLES.includes(table)) {
    return jsonResp({ error: "table must be one of " + ALLOWED_TABLES.join(", ") }, 400);
  }
  if (!message_id) return jsonResp({ error: "message_id required" }, 400);

  const admin = adminClient();

  // Read the attachments before deleting (service role — bypasses RLS read).
  const { data: row } = await admin
    .from(table)
    .select("attachments")
    .eq("id", message_id)
    .maybeSingle();

  // Delete the row through the caller's client so RLS authorizes it. If the
  // policy forbids it (or the row is already gone), 0 rows come back and we do
  // NOT touch storage.
  const { data: deleted, error: delErr } = await userClient
    .from(table)
    .delete()
    .eq("id", message_id)
    .select("id");
  if (delErr) return jsonResp({ error: delErr.message }, 400);
  if (!deleted || deleted.length === 0) {
    return jsonResp({ error: "Not permitted or message not found" }, 403);
  }

  // Row deleted with permission — remove its storage objects (service role, so
  // it works even when the deleter isn't the object owner, e.g. channel admin).
  let removed = 0;
  const attachments = Array.isArray(row?.attachments) ? row!.attachments : [];
  const paths = attachments
    .map((a: { url?: string }) => (a?.url ? pathFromPublicUrl(a.url) : null))
    .filter((p: string | null): p is string => !!p);
  if (paths.length > 0) {
    const { error: rmErr } = await admin.storage.from(BUCKET).remove(paths);
    if (rmErr) {
      // Row is already gone; report the storage error but don't fail hard.
      console.error("Storage remove error:", rmErr.message);
    } else {
      removed = paths.length;
    }
  }

  return jsonResp({ deleted: true, removed });
});
