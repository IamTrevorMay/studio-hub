// find-assets-enrich
// LLM context layer for the Beat Sheets "Find Assets" feature.
//
// op: "enrich" — batch of {key, field, tag, beat} items → per-item search
//   intelligence: what the tag is actually asking for (using the beat's
//   script text as context), a cleaned Shade query, structured pitch-archive
//   filters, a confidence score, and a web-search phrase. One Claude call,
//   tool-forced JSON so parsing never flakes.
//
// op: "external" — batch of {key, query, meaning} items the libraries came
//   up empty on → Claude with the server-side web_search tool finds ONE good
//   public link per item (news article, MLB.com page, YouTube video). The
//   client falls back to deterministic search-page URLs when this misses.
//
// Env: ANTHROPIC_API_KEY (required), CLAUDE_MODEL (optional override).
// Deploy: supabase functions deploy find-assets-enrich --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const MODEL = () => Deno.env.get("CLAUDE_MODEL") || "claude-sonnet-4-6";

const ENRICH_TOOL = {
  name: "report_enrichment",
  description: "Report the enriched search plan for every tag.",
  input_schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            key: { type: "string" },
            meaning: { type: "string", description: "One sentence: the specific visual/audio asset this tag wants, informed by the beat text." },
            confidence: { type: "number", description: "0-1: how sure you are about what specific asset is wanted." },
            shade_query: { type: "string", description: "2-6 word search query for a media asset library." },
            pitch: {
              type: ["object", "null"],
              description: "Only when the tag wants MLB game footage of a specific pitch/play; else null.",
              properties: {
                player_name: { type: ["string", "null"], description: "Player surname or full name, if one is implied." },
                pitch_types: { type: "array", items: { type: "string", enum: ["FF", "SI", "FC", "SL", "ST", "SV", "CU", "KC", "CH", "FS", "KN", "EP"] } },
                event: { type: ["string", "null"], enum: ["home_run", "strikeout", "single", "double", "triple", "walk", "field_out", "force_out", "grounded_into_double_play", "sac_fly", "hit_by_pitch", "field_error", null] },
              },
            },
            external_query: { type: "string", description: "A good web search phrase for finding this asset on the open web." },
          },
          required: ["key", "meaning", "confidence", "shade_query", "external_query"],
        },
      },
    },
    required: ["items"],
  },
};

async function callClaude(body: Record<string, unknown>, apiKey: string) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Claude API ${res.status}`);
  return data;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No authorization header" }, 401);
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: "Not authenticated" }, 401);
    const { data: profile } = await userClient.from("profiles").select("role").eq("id", user.id).single();
    if (!profile || profile.role === "agency" || profile.role === "partner") {
      return json({ error: "Not authorized" }, 403);
    }

    // Per-user daily spend cap (Claude + billable web_search). Enforced server-side
    // by bump_ai_usage (limit lives in the DB function, not the client).
    const { data: underCap } = await userClient.rpc("bump_ai_usage", { p_fn: "find-assets-enrich" });
    if (underCap === false) {
      return json({ error: "Daily AI usage limit reached. Try again tomorrow." }, 429);
    }

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 503);

    const body = await req.json().catch(() => ({}));
    const items = Array.isArray(body.items) ? body.items.slice(0, 80) : [];
    if (!items.length) return json({ error: "items required" }, 400);

    if (body.op === "enrich") {
      const prompt = [
        "You enrich asset-search queries for a baseball media team's video beat sheets.",
        "Each item is a tag someone attached to a beat (a segment of a video script), plus the beat's script text.",
        "The tag names an asset to source; the beat text is context for what is actually being talked about —",
        "use it to disambiguate players, teams, moments, and topics. Fields: 'videos' = B-Roll footage,",
        "'graphics' = images, 'notes' = audio/SFX/VFX.",
        "For each item report: meaning, confidence (0-1 that you know the SPECIFIC asset wanted),",
        "shade_query (short library search), pitch (ONLY for MLB gameplay footage requests: player name /",
        "pitch type codes / outcome event — null otherwise), and external_query (web search phrase).",
        "",
        JSON.stringify(items),
      ].join("\n");

      const data = await callClaude({
        model: MODEL(),
        max_tokens: 8192,
        tools: [ENRICH_TOOL],
        tool_choice: { type: "tool", name: "report_enrichment" },
        messages: [{ role: "user", content: prompt }],
      }, apiKey);

      const toolUse = (data.content || []).find((c: { type: string }) => c.type === "tool_use");
      const out = toolUse?.input?.items;
      if (!Array.isArray(out)) throw new Error("Enrichment returned no items");
      return json({ items: out });
    }

    if (body.op === "external") {
      const prompt = [
        "For each item below, use web search to find ONE good public web source the team could use as a",
        "visual reference or screenshot: a news article, MLB.com page, or YouTube video. Prefer recent,",
        "reputable, directly-relevant pages. Items are asset requests from a baseball media team.",
        "",
        JSON.stringify(items.map((i: Record<string, unknown>) => ({ key: i.key, query: i.query, meaning: i.meaning }))),
        "",
        "After searching, reply with ONLY a JSON array (no prose, no code fences):",
        '[{"key": "...", "title": "<page title, human-readable>", "url": "<direct link>"}]',
        "Omit items you could not find a genuinely relevant link for.",
      ].join("\n");

      const data = await callClaude({
        model: MODEL(),
        max_tokens: 4096,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: Math.min(items.length * 2, 12) }],
        messages: [{ role: "user", content: prompt }],
      }, apiKey);

      // Final text block carries the JSON array; parse defensively.
      const text = (data.content || [])
        .filter((c: { type: string }) => c.type === "text")
        .map((c: { text: string }) => c.text)
        .join("\n");
      const match = text.match(/\[[\s\S]*\]/);
      let links: Array<{ key: string; title: string; url: string }> = [];
      if (match) {
        try {
          const parsed = JSON.parse(match[0]);
          if (Array.isArray(parsed)) {
            links = parsed.filter((l) => l && typeof l.key === "string" && typeof l.url === "string" && /^https?:\/\//.test(l.url));
          }
        } catch { /* fall through to empty */ }
      }
      return json({ links });
    }

    return json({ error: `Unknown op: ${body.op}` }, 400);
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
