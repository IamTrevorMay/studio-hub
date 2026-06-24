// supabase/functions/progress-reorder/index.ts
// Admin drag-to-reorder for the Progress board's Editing / Ready columns.
// Writes the new position order to progress_cards and renames the corresponding
// Drive files to "N. <title>.<ext>" so the filename reflects priority.
//
// Order is asserted again on every sync-progress-cards run (self-heal), so this
// function is the immediate-feedback path; the cron is the backstop.
//
// Auth: admin JWT (Authorization: Bearer <user access token>).
// Body: { column: "editing" | "ready", orderedIds: string[] }  // top-first
// Deploy: supabase functions deploy progress-reorder --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  getDriveAccessToken,
  renameDriveFile,
  numberedName,
  nameHasNumber,
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
  let body: { column?: string; orderedIds?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResp({ error: "Invalid JSON" }, 400);
  }
  const column = body.column;
  if (column !== "editing" && column !== "ready") {
    return jsonResp({ error: "column must be 'editing' or 'ready'" }, 400);
  }
  const orderedIds = Array.isArray(body.orderedIds) ? body.orderedIds.filter((x) => typeof x === "string") : [];
  if (orderedIds.length === 0) return jsonResp({ error: "orderedIds required" }, 400);

  // ── Load the column's cards, confirm the ids belong to it ──────
  const { data: cards, error: cardsErr } = await admin
    .from("progress_cards")
    .select("id, title, status, drive_file_id, ready_drive_file_id")
    .eq("status", column)
    .is("archived_at", null);
  if (cardsErr) return jsonResp({ error: String(cardsErr) }, 500);

  const byId = new Map((cards || []).map((c) => [c.id, c]));
  // Only act on ids that are real cards in this column; preserve given order.
  const finalOrder = orderedIds.filter((id) => byId.has(id));
  if (finalOrder.length === 0) return jsonResp({ error: "No matching cards" }, 400);

  // ── Persist positions ─────────────────────────────────────────
  const now = new Date().toISOString();
  for (let i = 0; i < finalOrder.length; i++) {
    const { error } = await admin
      .from("progress_cards")
      .update({ position: i, updated_at: now })
      .eq("id", finalOrder[i]);
    if (error) return jsonResp({ error: String(error) }, 500);
  }

  // ── Rename Drive files to match (best-effort) ─────────────────
  let token: string | null = null;
  try {
    token = await getDriveAccessToken();
  } catch (err) {
    // Positions saved; filenames will be reconciled on next sync self-heal.
    return jsonResp({ ok: true, renamed: 0, warning: `Drive token failed: ${err}` });
  }

  let renamed = 0;
  const errors: string[] = [];
  for (let i = 0; i < finalOrder.length; i++) {
    const card = byId.get(finalOrder[i])!;
    const fileId = column === "editing" ? card.drive_file_id : card.ready_drive_file_id;
    if (!fileId) continue;
    try {
      const currentName = await getDriveFileName(token, fileId);
      if (!currentName) continue;
      if (nameHasNumber(currentName, i + 1)) continue; // already correct
      await renameDriveFile(token, fileId, numberedName(currentName, card.title, i + 1));
      renamed++;
    } catch (err) {
      errors.push(`${card.title}: ${err}`);
    }
  }

  return jsonResp({ ok: true, count: finalOrder.length, renamed, errors });
});
