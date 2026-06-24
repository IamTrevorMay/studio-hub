// supabase/functions/progress-rename/index.ts
// Admin inline-rename of a Progress card title (double-click on the board).
// Updates progress_cards.title AND renames the card's active Drive file to
// match in one shot — renaming the file is required, not optional: sync matches
// files to cards by filename, so a DB title change without the file rename
// would make the next sync treat the old-named file as a new card (duplicate).
//
// The file keeps its column's "N. " number prefix (editing/ready) or stays
// unnumbered with its "(S)" (scheduled).
//
// Auth: admin JWT.
// Body: { cardId: string, title: string }
// Deploy: supabase functions deploy progress-rename --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  getDriveAccessToken,
  renameDriveFile,
  numberedName,
  unnumberedName,
  hasScheduledPrefix,
} from "../shared/progress-drive.ts";

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

async function getDriveFileName(token: string, fileId: string): Promise<string | null> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=name`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) return null;
  const json = await res.json();
  return json.name || null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResp({ error: "Method not allowed" }, 405);

  // ── Auth: admin only ──────────────────────────────────────────
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return jsonResp({ error: "Unauthorized" }, 401);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: { user } } = await admin.auth.getUser(auth.replace("Bearer ", ""));
  if (!user) return jsonResp({ error: "Unauthorized" }, 401);
  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") return jsonResp({ error: "Forbidden" }, 403);

  // ── Validate body ─────────────────────────────────────────────
  let body: { cardId?: string; title?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResp({ error: "Invalid JSON" }, 400);
  }
  const cardId = body.cardId;
  const title = (body.title || "").trim();
  if (!cardId) return jsonResp({ error: "cardId required" }, 400);
  if (!title) return jsonResp({ error: "title cannot be empty" }, 400);

  const { data: card, error: cardErr } = await admin
    .from("progress_cards")
    .select("id, title, status, position, drive_file_id, ready_drive_file_id")
    .eq("id", cardId)
    .is("archived_at", null)
    .single();
  if (cardErr || !card) return jsonResp({ error: "Card not found" }, 404);

  if (title === card.title) return jsonResp({ ok: true, unchanged: true });

  // ── Update DB title (unique index may reject a duplicate) ─────
  const { error: upErr } = await admin
    .from("progress_cards")
    .update({ title, updated_at: new Date().toISOString() })
    .eq("id", cardId);
  if (upErr) {
    const dup = /duplicate|unique/i.test(String(upErr.message || upErr));
    return jsonResp({ error: dup ? "A card with that title already exists" : String(upErr) }, dup ? 409 : 500);
  }

  // ── Rename the active Drive file to match (best-effort) ───────
  const fileId = card.status === "editing"
    ? card.drive_file_id
    : (card.ready_drive_file_id || card.drive_file_id);

  if (!fileId) return jsonResp({ ok: true, renamed: false });

  try {
    const token = await getDriveAccessToken();
    const currentName = await getDriveFileName(token, fileId);
    if (currentName) {
      const newName = card.status === "scheduled"
        ? unnumberedName(currentName, title, hasScheduledPrefix(currentName))
        : numberedName(currentName, title, (card.position ?? 0) + 1);
      await renameDriveFile(token, fileId, newName);
      return jsonResp({ ok: true, renamed: true });
    }
  } catch (err) {
    // Title is saved; the next sync self-heal will rename the file to match.
    return jsonResp({ ok: true, renamed: false, warning: String(err) });
  }
  return jsonResp({ ok: true, renamed: false });
});
