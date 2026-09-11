// Film Queue shared logic for edge functions: session packing, prompter
// compilation, and the task pipeline transitions
// (fq_write → fq_review → fq_send → fq_edit).
//
// The packer must stay in sync with src/lib/filmQueue.js — the Film Queue view
// derives the same "next session" display client-side.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { notifyUser } from "./workflow-engine.ts";

// Trevor May — reviews every queue beat sheet and owns the Send to Editor step
// (same id as RESEARCH_SCOPE_OWNER in card-move and TREVOR in action-registry).
export const FILM_QUEUE_REVIEWER = "c3290048-436b-46c6-b3f0-fdf7923d0c3b";

export const SESSION_MINUTES_LIMIT = 60;
export const SESSION_ITEM_LIMIT = 6;

export const DEFAULT_MINUTES: Record<string, number> = {
  mayday: 25,
  tm_baseball: 25,
  short_form: 5,
  ad: 5,
};

export const QUEUE_TYPE_LABELS: Record<string, string> = {
  mayday: "Mayday",
  tm_baseball: "TM Baseball",
  short_form: "Short Form",
  ad: "Ad",
};

// Queue type → beat_sheet_tags.label for stamping enqueued sheets.
export const QUEUE_TYPE_TO_SHEET_TAG: Record<string, string> = {
  mayday: "Mayday",
  tm_baseball: "Trevor May Baseball",
  short_form: "Short Form",
  ad: "Ad Read",
};

export function defaultMinutesFor(queueType: string): number {
  return DEFAULT_MINUTES[queueType] ?? 25;
}

interface LineItem {
  id: string;
  queue_type: string;
  estimated_minutes?: number | null;
  approved_at?: string | null;
  created_at?: string | null;
  [key: string]: unknown;
}

// Ads float to the top, then oldest approved first.
export function orderTheLine<T extends LineItem>(items: T[]): T[] {
  return [...(items || [])].sort((a, b) => {
    const adA = a.queue_type === "ad" ? 0 : 1;
    const adB = b.queue_type === "ad" ? 0 : 1;
    if (adA !== adB) return adA - adB;
    const ta = new Date(a.approved_at || a.created_at || 0).getTime();
    const tb = new Date(b.approved_at || b.created_at || 0).getTime();
    if (ta !== tb) return ta - tb;
    return String(a.id).localeCompare(String(b.id));
  });
}

// Strict-prefix fill to 60 minutes / 6 items, whichever hits first. The first
// item that doesn't fit stops the pack and keeps its place at the front of the
// line. A session always takes at least one item.
export function packSession<T extends LineItem>(
  items: T[],
): { packed: T[]; remaining: T[]; totalMinutes: number } {
  const line = orderTheLine(items);
  const packed: T[] = [];
  let totalMinutes = 0;
  for (const item of line) {
    const minutes = Number(item.estimated_minutes) || defaultMinutesFor(item.queue_type);
    if (packed.length >= SESSION_ITEM_LIMIT) break;
    if (packed.length > 0 && totalMinutes + minutes > SESSION_MINUTES_LIMIT) break;
    packed.push(item);
    totalMinutes += minutes;
  }
  return { packed, remaining: line.slice(packed.length), totalMinutes };
}

// ── Pacific-time clock ──────────────────────────────────────────────────────
// pg_cron runs on UTC, so the lock job fires at two UTC slots and gates here
// on the real PT hour (same approach as run-automations).
export function ptNow(date = new Date()): { isoDate: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "00";
  return {
    isoDate: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")) % 24,
  };
}

// ── Prompter compilation ────────────────────────────────────────────────────
// Beat → HTML mirrors Production.js pushScript: yellow graphics cues, beat
// text with bullet handling, blue video cues. Context and notes are omitted
// there on purpose, so they're omitted here too.

interface Beat {
  type?: string;
  title?: string;
  graphics?: unknown[];
  videos?: unknown[];
  children?: Beat[];
}

function flattenBeats(items: Beat[]): Beat[] {
  const out: Beat[] = [];
  for (const item of items || []) {
    if (item?.type === "segment") out.push(...(item.children || []));
    else if (item) out.push(item);
  }
  return out;
}

function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function textToHtml(text?: string): string {
  if (!text?.trim()) return "";
  const lines = text.split("\n");
  let html = "";
  let inList = false;
  for (const line of lines) {
    const m = line.match(/^(\s*)[•\-]\s(.*)$/);
    if (m) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${escapeHtml(m[2])}</li>`;
    } else {
      if (inList) { html += "</ul>"; inList = false; }
      if (line.trim()) html += `<p>${escapeHtml(line)}</p>`;
      else html += "<br>";
    }
  }
  if (inList) html += "</ul>";
  return html;
}

function cueText(entry: unknown): string {
  if (entry && typeof entry === "object") {
    const media = entry as { title?: string; name?: string };
    return media.title || media.name || "";
  }
  return String(entry ?? "");
}

const GRAPHICS_CUE_STYLE =
  "color:#facc15; font-size:0.7em; font-weight:600; letter-spacing:0.08em; text-transform:uppercase; margin:0.3em 0;";
const VIDEO_CUE_STYLE =
  "color:#38bdf8; font-size:0.7em; font-weight:600; letter-spacing:0.08em; text-transform:uppercase; margin:0.3em 0;";
const BEAT_DIVIDER =
  '<div style="border-top:1px solid rgba(255,255,255,0.12); margin:1.8em 0;"></div>';
// The hard break between slates — heavier than the per-beat divider.
const SLATE_DIVIDER =
  '<div style="border-top:3px double rgba(255,255,255,0.4); margin:3.5em 0;"></div>';

export function beatsToPrompterHtml(beats: Beat[]): string {
  const parts = flattenBeats(beats)
    .filter((b) => (b.title || "").trim())
    .map((b) => {
      const chunks: string[] = [];
      if (b.graphics && b.graphics.length > 0) {
        chunks.push(
          `<p style="${GRAPHICS_CUE_STYLE}">${b.graphics.map((g) => `[ ${escapeHtml(cueText(g))} ]`).join("  ")}</p>`,
        );
      }
      chunks.push(textToHtml(b.title));
      if (b.videos && b.videos.length > 0) {
        chunks.push(
          `<p style="${VIDEO_CUE_STYLE}">${b.videos.map((v) => `[ ${escapeHtml(cueText(v))} ]`).join("  ")}</p>`,
        );
      }
      return chunks.join("");
    });
  return parts.join(BEAT_DIVIDER);
}

// Concatenate packed sheets in slate order with a title card and a hard break
// between each.
export function compilePrompterSession(
  sheets: Array<{ title: string; queue_type: string; beats: Beat[] }>,
): string {
  return sheets
    .map((sheet, i) => {
      const typeLabel = QUEUE_TYPE_LABELS[sheet.queue_type] || sheet.queue_type;
      const titleCard =
        `<h1 style="text-align:center; margin:0.8em 0 0.2em;">Slate ${i + 1} — ${escapeHtml(sheet.title)}</h1>` +
        `<p style="text-align:center; color:rgba(255,255,255,0.5); font-size:0.6em; letter-spacing:0.1em; text-transform:uppercase; margin:0 0 1.2em;">${escapeHtml(typeLabel)}</p>`;
      return titleCard + beatsToPrompterHtml(sheet.beats || []);
    })
    .join(SLATE_DIVIDER);
}

// ── Task pipeline ───────────────────────────────────────────────────────────

function isHttpUrl(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export async function createFilmQueueTask(
  admin: SupabaseClient,
  opts: {
    stepKey: string;
    title: string;
    description: string;
    assigneeId: string;
    itemId: string;
    linkUrl?: string | null;
    createdBy?: string | null;
    notifyTitle: string;
    notifyBody: string;
  },
): Promise<{ id: string } | null> {
  const { data: task, error } = await admin
    .from("tasks")
    .insert({
      step_key: opts.stepKey,
      title: opts.title,
      description: opts.description,
      assignee_id: opts.assigneeId,
      status: "pending",
      related_entity_type: "film_queue_item",
      related_entity_id: opts.itemId,
      link_url: opts.linkUrl || null,
      created_by: opts.createdBy || null,
    })
    .select("id")
    .single();
  if (error || !task) {
    console.error("film-queue task insert failed:", error?.message);
    return null;
  }
  await notifyUser(admin, opts.assigneeId, opts.notifyTitle, opts.notifyBody, task.id);
  return task as { id: string };
}

// Pre-completion validation for fq_* tasks. Returns an error message (blocks
// completion with a 400) or null. Runs server-side so no path can skip it —
// the "needs a link to hit Send" rule lives here, mirroring requires_hours.
export async function filmQueueCompletionGate(
  admin: SupabaseClient,
  task: { step_key?: string | null; related_entity_id?: string | null },
  payload: Record<string, unknown> | undefined,
): Promise<string | null> {
  if (task.step_key === "fq_send") {
    if (!isHttpUrl(payload?.video_url)) {
      return "Paste the link to the video file to send this to the editor.";
    }
    const { data: item } = await admin
      .from("film_queue_items")
      .select("editor_id")
      .eq("id", task.related_entity_id)
      .single();
    if (!item?.editor_id) {
      return "Assign an editor in the Film Queue before sending.";
    }
  }
  if (task.step_key === "fq_edit") {
    if (!isHttpUrl(payload?.cut_url)) {
      return "Paste the link to the finished cut to complete this task.";
    }
  }
  return null;
}

// Post-completion transition for fq_* tasks. The completing task is already
// marked complete; this moves the beat sheet / queue item along and creates
// the next task in the chain.
export async function advanceFilmQueue(
  admin: SupabaseClient,
  task: {
    step_key?: string | null;
    related_entity_id?: string | null;
    assignee_id?: string | null;
  },
  payload: Record<string, unknown> | undefined,
): Promise<{ next_task_ids: string[]; note?: string }> {
  const itemId = task.related_entity_id;
  if (!itemId) return { next_task_ids: [], note: "no film queue item" };

  const { data: item } = await admin
    .from("film_queue_items")
    .select("*, sheet:beat_sheets(id, title, status)")
    .eq("id", itemId)
    .single();
  if (!item) return { next_task_ids: [], note: "film queue item missing" };

  const sheetTitle = item.sheet?.title || "Untitled";
  const nowIso = new Date().toISOString();

  switch (task.step_key) {
    case "fq_write": {
      // Writer finished — sheet goes into review, reviewer gets a task.
      await admin
        .from("beat_sheets")
        .update({ status: "ready_for_review" })
        .eq("id", item.beat_sheet_id);
      const next = await createFilmQueueTask(admin, {
        stepKey: "fq_review",
        title: `${sheetTitle} — Review Beat Sheet`,
        description:
          "Review the beat sheet. Completing this task approves it and puts it in the film queue line.",
        assigneeId: FILM_QUEUE_REVIEWER,
        itemId,
        createdBy: task.assignee_id,
        notifyTitle: "Beat sheet ready for review",
        notifyBody: `"${sheetTitle}" is ready for your review.`,
      });
      return { next_task_ids: next ? [next.id] : [] };
    }

    case "fq_review": {
      // Approved — into the line, and the Send to Editor task appears.
      await admin
        .from("beat_sheets")
        .update({ status: "approved", approved_at: nowIso })
        .eq("id", item.beat_sheet_id);
      const next = await createFilmQueueTask(admin, {
        stepKey: "fq_send",
        title: `${sheetTitle} — Send to Editor`,
        description:
          "After the shoot, paste the link to the video file and hit Send to Editor. That sends the edit task and moves this item to the edit pile.",
        assigneeId: FILM_QUEUE_REVIEWER,
        itemId,
        createdBy: task.assignee_id,
        notifyTitle: "Beat sheet approved",
        notifyBody: `"${sheetTitle}" is approved and in the film queue line.`,
      });
      return { next_task_ids: next ? [next.id] : [] };
    }

    case "fq_send": {
      // Send = filmed: the item leaves the queue for the edit pile and the
      // editor's task opens with the raw video linked.
      const videoUrl = String(payload?.video_url || "").trim();
      await admin
        .from("film_queue_items")
        .update({
          state: "filmed",
          filmed_at: nowIso,
          video_url: videoUrl,
          updated_at: nowIso,
        })
        .eq("id", itemId);
      if (!item.editor_id) return { next_task_ids: [], note: "no editor assigned" };
      const next = await createFilmQueueTask(admin, {
        stepKey: "fq_edit",
        title: `${sheetTitle} — Edit`,
        description:
          "Edit the video — the raw file is linked on this task. When the finished cut is uploaded, paste its link and complete.",
        assigneeId: item.editor_id,
        itemId,
        linkUrl: videoUrl,
        createdBy: task.assignee_id,
        notifyTitle: "New edit task",
        notifyBody: `"${sheetTitle}" was filmed and is ready to edit.`,
      });
      return { next_task_ids: next ? [next.id] : [] };
    }

    case "fq_edit": {
      // Finished cut delivered — the item is done.
      await admin
        .from("film_queue_items")
        .update({
          state: "done",
          cut_url: String(payload?.cut_url || "").trim() || null,
          updated_at: nowIso,
        })
        .eq("id", itemId);
      return { next_task_ids: [], note: "pipeline complete" };
    }

    default:
      return { next_task_ids: [], note: `unknown step ${task.step_key}` };
  }
}
