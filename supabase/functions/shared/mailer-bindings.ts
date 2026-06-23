// Data-binding resolution for mailer campaigns ported from the Triton
// "Mayday Daily" digest. At send time we walk the campaign blocks, fetch
// the bound data once (from the Triton Supabase project — read-only) and
// return a map of blockId -> resolved data that the renderer consumes via
// ctx.blockData.
//
// Sources:
//   briefs       -> briefs row for the date; path selects metadata.* slices
//   daily_cards  -> daily_cards row for the date (drives the starter-card image)
//   claude       -> pre-generated HTML stored in briefs.metadata[claudeField]
//   rss          -> handled separately by the existing rss-card path
//
// The "Claude" sections are NOT generated here — Triton bakes them into the
// brief upstream; we just read them.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

type Json = Record<string, unknown>;

// Accent colors for standout cards (light theme).
const AMBER = "#d97706";
const BLUE = "#2563eb";

// Triton project client. Read-only service role lives in TRITON_* secrets.
export function getTritonClient(): SupabaseClient | null {
  const url = Deno.env.get("TRITON_SUPABASE_URL");
  const key = Deno.env.get("TRITON_SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return createClient(url, key);
}

// Yesterday's date (YYYY-MM-DD) in America/New_York — matches Triton's cron.
export function digestDateET(now: Date = new Date()): string {
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  et.setDate(et.getDate() - 1);
  return et.toISOString().slice(0, 10);
}

function getByPath(obj: Json, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Json)) return (acc as Json)[key];
    return undefined;
  }, obj);
}

// Convert briefs.metadata.daily_highlights into standout card objects.
// Ported from Triton's highlightsToStandouts.
export function highlightsToStandouts(highlights: unknown): Json[] {
  const h = highlights as Json | undefined;
  if (!h) return [];
  const out: Json[] = [];
  const push = (s: Json | undefined, plusKey: string, plus_label: string, accent: string, role_label: string, subtitle: string) => {
    if (!s) return;
    out.push({
      player_id: s.player_id,
      player_name: s.player_name,
      team: s.team,
      plus_value: s[plusKey],
      plus_label,
      accent_color: accent,
      role_label,
      subtitle,
      game_line: s.game_line ?? null,
    });
  };
  const ss = h.stuff_starter as Json | undefined;
  const sr = h.stuff_reliever as Json | undefined;
  const cs = h.cmd_starter as Json | undefined;
  const cr = h.cmd_reliever as Json | undefined;
  push(ss, "stuff_plus", "Stuff+", AMBER, "Starter", (ss?.pitch_name as string) || "");
  push(sr, "stuff_plus", "Stuff+", AMBER, "Reliever", (sr?.pitch_name as string) || "");
  push(cs, "cmd_plus", "Cmd+", BLUE, "Starter", cs ? `${cs.pitches} pitches` : "");
  push(cr, "cmd_plus", "Cmd+", BLUE, "Reliever", cr ? `${cr.pitches} pitches` : "");
  return out;
}

// deno-lint-ignore no-explicit-any
function collectBound(blocks: any[], acc: any[] = []): any[] {
  for (const b of (blocks || [])) {
    if (!b) continue;
    if (b.binding && b.id) acc.push(b);
    if (Array.isArray(b.children)) {
      if (Array.isArray(b.children[0])) for (const col of b.children) collectBound(col, acc);
      else collectBound(b.children, acc);
    }
  }
  return acc;
}

// Resolve all bound blocks. Returns { [blockId]: data }. Never throws —
// a failed source yields empty data so the block renders nothing.
// deno-lint-ignore no-explicit-any
export async function resolveBlockData(blocks: any[], date: string): Promise<Record<string, Json>> {
  const result: Record<string, Json> = {};
  const bound = collectBound(blocks);
  if (bound.length === 0) return result;

  const triton = getTritonClient();
  if (!triton) return result; // Triton not configured — leave data empty.

  // Pre-fetch the brief + daily_card once (most bindings need the brief).
  let brief: Json | null = null;
  let dailyCard: Json | null = null;
  try {
    const { data } = await triton.from("briefs").select("*").eq("date", date)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    brief = (data as Json) || null;
  } catch { /* leave null */ }

  const needsCard = bound.some((b) => b.binding?.source === "daily_cards");
  if (needsCard) {
    try {
      const { data } = await triton.from("daily_cards").select("*").eq("date", date).limit(1).maybeSingle();
      dailyCard = (data as Json) || null;
    } catch { /* leave null */ }
  }

  for (const b of bound) {
    const src = b.binding.source;
    try {
      if (src === "briefs") {
        if (!brief) { result[b.id] = {}; continue; }
        const path: string | undefined = b.binding.path;
        if (path === "metadata.daily_highlights") {
          result[b.id] = { standouts: highlightsToStandouts(getByPath(brief, path)) };
        } else if (path === "metadata.scores") {
          result[b.id] = { scores: getByPath(brief, path) || [] };
        } else if (path === "metadata.trend_alerts") {
          const alerts = (getByPath(brief, path) as Json) || {};
          result[b.id] = { surges: alerts.surges || [], concerns: alerts.concerns || [] };
        } else if (path) {
          result[b.id] = { data: getByPath(brief, path) };
        } else {
          result[b.id] = brief;
        }
      } else if (src === "daily_cards") {
        result[b.id] = { date, ...(dailyCard || {}) };
      } else if (src === "claude") {
        const meta = (brief?.metadata as Json) || {};
        const field: string | undefined = b.binding.claudeField;
        result[b.id] = { html: (field && (meta[field] as string)) || "" };
      } else {
        result[b.id] = {};
      }
    } catch {
      result[b.id] = {};
    }
  }

  return result;
}
