// supabase/functions/organize-autotag/index.ts
// AI auto-labeling for the Organize tool. Given a batch of media items, returns
// suggested metadata { type, subtype, title, description, confidence } that the
// client drops into the existing tag fields — nothing is moved server-side, the
// user still confirms and runs Organize locally.
//
// - Visual (image / video keyframe): Claude vision classifies into the taxonomy.
// - Audio: no audio input to Claude, so it reads the filename + duration text
//   and picks an Audio subtype + writes a clean title/description.
//
// Suggestions are clamped to the Organize taxonomy (TYPE_OPTIONS / SUBTYPE_MAP);
// anything off-taxonomy is dropped to a low confidence so the client flags it
// for review rather than auto-accepting.
//
// Auth: any authenticated user (Organize is a general tool, not admin-gated).
// Body: { items: [{ id, name, ext, category, imageBase64?, durationSec? }] }
// Returns: { results: [{ id, type, subtype, title, description, confidence, error? }] }
// Deploy: supabase functions deploy organize-autotag --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Mirror of src/pages/tools/organize/organizeConstants.js — keep in sync.
const TYPE_OPTIONS = ["Video", "Image", "Graphic", "Audio", "VFX"];
const SUBTYPE_MAP: Record<string, string[]> = {
  Video: ["A-Roll", "B-Roll", "VO"],
  Image: ["Text", "Diagram", "Photo"],
  Graphic: ["Overlay", "Background", "Bar", "Lower Third"],
  Audio: ["Music", "ADR/VO", "SFX"],
  VFX: ["Preset", "Motion", "After Effects"],
};

const MODEL = Deno.env.get("CLAUDE_MODEL") || "claude-sonnet-4-6";
const MAX_ITEMS = 12; // client batches ~6; cap defensively

function jsonResp(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Resolve the caller and atomically bump their daily AI-usage counter.
// Returns { ok, underCap }: ok=false → not authenticated; underCap=false → over the
// per-user daily cap (limit lives in the bump_ai_usage DB function).
async function authAndCap(req: Request): Promise<{ ok: boolean; underCap: boolean }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return { ok: false, underCap: false };
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) return { ok: false, underCap: false };
  const { data: underCap } = await userClient.rpc("bump_ai_usage", { p_fn: "organize-autotag" });
  return { ok: true, underCap: underCap !== false };
}

const TAXONOMY_TEXT = TYPE_OPTIONS
  .map((t) => `- ${t}: ${SUBTYPE_MAP[t].join(", ")}`)
  .join("\n");

// Pull the first {...} JSON object out of a model reply (handles code fences /
// stray prose around it).
function extractJson(text: string): Record<string, unknown> | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function clampConfidence(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

// Validate a {type, subtype} pair against the taxonomy. Returns the cleaned pair
// and whether it was valid (invalid → caller lowers confidence).
function normalizeTypeSubtype(type: string, subtype: string): { type: string; subtype: string; valid: boolean } {
  const t = TYPE_OPTIONS.find((o) => o.toLowerCase() === type.toLowerCase()) || "";
  if (!t) return { type: "", subtype: "", valid: false };
  const s = (SUBTYPE_MAP[t] || []).find((o) => o.toLowerCase() === subtype.toLowerCase()) || "";
  return { type: t, subtype: s, valid: !!s };
}

async function callClaude(anthropicKey: string, content: unknown): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      messages: [{ role: "user", content }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return data?.content?.[0]?.text || "";
}

function visualPrompt(item: { name: string; category: string }): string {
  return `You are labeling a media asset for an internal creator-team library. Classify it using ONLY this taxonomy (type, then a valid subtype for that type):
${TAXONOMY_TEXT}

This is a ${item.category} file named "${item.name}". ${item.category === "video" ? "The image is a representative keyframe from the video." : "The image is the asset itself."}

Decide the single best type and subtype from the taxonomy above. Write a short human-readable Title (no file extension, Title Case, 2-6 words) and a one-sentence Description of what the asset shows/contains.

Respond with ONLY a JSON object, no prose:
{"type":"<one of ${TYPE_OPTIONS.join("|")}>","subtype":"<a valid subtype for that type>","title":"...","description":"...","confidence":<0-1 how sure you are>}`;
}

function audioPrompt(item: { name: string; durationSec?: number }): string {
  const dur = typeof item.durationSec === "number" && item.durationSec > 0
    ? `${item.durationSec.toFixed(1)} seconds`
    : "unknown";
  return `You are labeling an AUDIO asset for an internal creator-team library. You cannot hear it — infer from the filename and duration only.

Filename: "${item.name}"
Duration: ${dur}

Pick the best Audio subtype from: ${SUBTYPE_MAP.Audio.join(", ")}.
Guidance: Music = songs/tracks/loops/score (usually longer); SFX = short sound effects, whooshes, impacts, foley (usually short); ADR/VO = recorded voice, narration, dialogue.

Write a short human-readable Title (no file extension, Title Case, 2-6 words) and a one-sentence Description.

Respond with ONLY a JSON object, no prose:
{"subtype":"<Music|ADR/VO|SFX>","title":"...","description":"...","confidence":<0-1 how sure you are>}`;
}

async function tagItem(
  item: { id: string; name: string; ext: string; category: string; imageBase64?: string; durationSec?: number },
  anthropicKey: string,
) {
  const base = { id: item.id };
  try {
    const isVisual = !!item.imageBase64 && (item.category === "image" || item.category === "video");

    if (isVisual) {
      const content = [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: item.imageBase64 } },
        { type: "text", text: visualPrompt(item) },
      ];
      const reply = await callClaude(anthropicKey, content);
      const parsed = extractJson(reply);
      if (!parsed) return { ...base, error: "parse_failed", confidence: 0 };
      const { type, subtype, valid } = normalizeTypeSubtype(str(parsed.type), str(parsed.subtype));
      const conf = clampConfidence(parsed.confidence);
      return {
        ...base,
        type,
        subtype,
        title: str(parsed.title),
        description: str(parsed.description),
        confidence: valid ? conf : Math.min(conf, 0.4),
      };
    }

    if (item.category === "audio") {
      const reply = await callClaude(anthropicKey, audioPrompt(item));
      const parsed = extractJson(reply);
      if (!parsed) return { ...base, error: "parse_failed", confidence: 0 };
      const { type, subtype, valid } = normalizeTypeSubtype("Audio", str(parsed.subtype));
      const conf = clampConfidence(parsed.confidence);
      return {
        ...base,
        type, // "Audio"
        subtype,
        title: str(parsed.title),
        description: str(parsed.description),
        confidence: valid ? conf : Math.min(conf, 0.4),
      };
    }

    return { ...base, error: "unsupported", confidence: 0 };
  } catch (err) {
    return { ...base, error: String(err instanceof Error ? err.message : err), confidence: 0 };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResp({ error: "Method not allowed" }, 405);

  const gate = await authAndCap(req);
  if (!gate.ok) return jsonResp({ error: "Not authenticated" }, 401);
  if (!gate.underCap) return jsonResp({ error: "Daily AI usage limit reached. Try again tomorrow." }, 429);

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) return jsonResp({ error: "ANTHROPIC_API_KEY not configured" }, 500);

  let body: { items?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResp({ error: "Invalid JSON" }, 400);
  }

  const items = Array.isArray(body.items) ? body.items : null;
  if (!items || items.length === 0) return jsonResp({ error: "No items" }, 400);
  if (items.length > MAX_ITEMS) return jsonResp({ error: `Max ${MAX_ITEMS} items per request` }, 400);

  // Run the batch concurrently — each item is an independent Claude call.
  const results = await Promise.all(items.map((it) => tagItem(it as never, anthropicKey)));
  return jsonResp({ results });
});
