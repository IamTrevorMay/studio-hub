// supabase/functions/find-broll/index.ts
// Deploy with: supabase functions deploy find-broll --no-verify-jwt
// Analyzes beat text via Claude, then searches Brave for B-Roll suggestions.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createHandler } from "../shared/handler.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonRes(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Domain priority for sorting results (lower = better)
const DOMAIN_PRIORITY: Record<string, number> = {
  "mlb.com": 0,
  "youtube.com": 1,
  "espn.com": 2,
  "sports.yahoo.com": 3,
  "theathletic.com": 4,
};

function getDomainLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host.includes("mlb.com")) return "mlb";
    if (host.includes("youtube.com") || host.includes("youtu.be")) return "youtube";
    if (host.includes("espn.com")) return "espn";
    if (host.includes("yahoo.com")) return "yahoo";
    if (host.includes("theathletic.com")) return "athletic";
    return "other";
  } catch {
    return "other";
  }
}

function getDomainPriority(url: string): number {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    for (const [domain, priority] of Object.entries(DOMAIN_PRIORITY)) {
      if (host.includes(domain)) return priority;
    }
  } catch {
    // ignore
  }
  return 99;
}

Deno.serve(
  createHandler({ auth: "jwt", methods: ["POST"] }, async ({ req }) => {
    const { beat_text } = await req.json();

    if (!beat_text || typeof beat_text !== "string" || beat_text.trim().length < 5) {
      return jsonRes({ error: "Beat text too short for B-Roll search" }, 400);
    }

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      return jsonRes({ error: "ANTHROPIC_API_KEY not configured" }, 500);
    }

    const braveKey = Deno.env.get("BRAVE_SEARCH_API_KEY");
    if (!braveKey) {
      return jsonRes({ error: "BRAVE_SEARCH_API_KEY not configured" }, 500);
    }

    const model = Deno.env.get("CLAUDE_MODEL") || "claude-sonnet-4-20250514";

    // ── Step 1: Claude analysis ──
    let subjects: string[] = [];
    let queries: string[] = [];

    const claudeController = new AbortController();
    const claudeTimeout = setTimeout(() => claudeController.abort(), 30000);

    try {
      const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: claudeController.signal,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          system: `You extract key subjects and generate search queries from video script beats.
Given a beat (a short script segment), identify the key subjects (people, teams, events, plays) and generate 3-5 targeted search queries optimized for finding video footage and highlight clips.
Prioritize sports content sources (MLB.com, YouTube highlights, ESPN) when the content is sports-related.
Return ONLY valid JSON with no markdown formatting: { "subjects": ["..."], "queries": ["..."] }`,
          messages: [{ role: "user", content: beat_text.trim() }],
        }),
      });

      clearTimeout(claudeTimeout);

      if (!claudeResp.ok) {
        const errBody = await claudeResp.text();
        console.error("Claude API error:", claudeResp.status, errBody);
        return jsonRes({ error: "Claude analysis failed" }, 502);
      }

      const claudeData = await claudeResp.json();
      const rawText = claudeData.content?.[0]?.text || "";
      const cleaned = rawText.replace(/^```json?\s*/i, "").replace(/\s*```$/i, "").trim();
      const parsed = JSON.parse(cleaned);
      subjects = parsed.subjects || [];
      queries = (parsed.queries || []).slice(0, 5);

      if (!queries.length) {
        return jsonRes({ suggestions: [], subjects, message: "No search queries generated" });
      }
    } catch (err) {
      clearTimeout(claudeTimeout);
      if (err.name === "AbortError") {
        return jsonRes({ error: "Claude analysis timed out" }, 504);
      }
      console.error("Claude analysis error:", err);
      return jsonRes({ error: "Claude analysis failed" }, 502);
    }

    // ── Step 2: Brave Search ──
    const searchResults = await Promise.allSettled(
      queries.map(async (query) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        try {
          const params = new URLSearchParams({ q: query, count: "5" });
          const resp = await fetch(
            `https://api.search.brave.com/res/v1/web/search?${params}`,
            {
              signal: controller.signal,
              headers: {
                "X-Subscription-Token": braveKey,
                "Accept": "application/json",
              },
            }
          );
          clearTimeout(timeout);
          if (!resp.ok) return [];
          const data = await resp.json();
          return (data.web?.results || []).map(
            (r: { title: string; url: string; description: string }) => ({
              title: r.title,
              url: r.url,
              description: r.description || "",
            })
          );
        } catch {
          clearTimeout(timeout);
          return [];
        }
      })
    );

    // ── Step 3: Deduplicate and prioritize ──
    const seenUrls = new Set<string>();
    const allResults: { title: string; url: string; source: string; description: string; priority: number }[] = [];

    for (const result of searchResults) {
      if (result.status !== "fulfilled") continue;
      for (const item of result.value) {
        if (seenUrls.has(item.url)) continue;
        seenUrls.add(item.url);
        allResults.push({
          title: item.title,
          url: item.url,
          source: getDomainLabel(item.url),
          description: item.description,
          priority: getDomainPriority(item.url),
        });
      }
    }

    // Sort by domain priority, take top 8
    allResults.sort((a, b) => a.priority - b.priority);
    const suggestions = allResults.slice(0, 8).map(({ priority: _, ...rest }) => rest);

    if (!suggestions.length) {
      return jsonRes({ suggestions: [], subjects, message: "No results found" });
    }

    return jsonRes({ suggestions, subjects });
  })
);
