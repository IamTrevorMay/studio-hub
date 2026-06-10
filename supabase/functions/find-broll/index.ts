// supabase/functions/find-broll/index.ts
// Deploy with: supabase functions deploy find-broll --no-verify-jwt
// Analyzes beat text via Claude, then searches Brave for B-Roll suggestions.
// Returns videos and articles separately (up to 4 each), baseball-focused.

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

/** Classify a result as video or article based on URL patterns */
function classifyResult(url: string, source: string): "video" | "article" {
  try {
    const path = new URL(url).pathname.toLowerCase();

    // YouTube is always video
    if (source === "youtube") return "video";

    // MLB.com video paths
    if (source === "mlb" && (path.includes("/video") || path.includes("/gameday"))) return "video";

    // ESPN video paths
    if (source === "espn" && (path.includes("/video") || path.includes("/watch"))) return "video";

    // Yahoo video paths
    if (source === "yahoo" && path.includes("/video")) return "video";

    // Generic video indicators in URL
    if (/\/(video|watch|clip|highlight|play)s?\b/.test(path)) return "video";
  } catch {
    // ignore
  }
  return "article";
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
          system: `You extract key subjects and generate search queries from baseball video script beats.
Given a beat (a short script segment about baseball/MLB), identify the key subjects (players, teams, plays, games) and generate 3-5 targeted search queries.
ALL queries MUST be baseball/MLB focused. Always include "baseball" or "MLB" in queries when not already obvious.
Generate a mix of queries: some targeting video highlights (include "highlights", "video", or "clip") and some targeting articles/analysis.
Prioritize MLB.com, YouTube, ESPN, and The Athletic as sources.
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
        return jsonRes({ videos: [], articles: [], subjects, message: "No search queries generated" });
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

    // ── Step 3: Deduplicate, classify, and prioritize ──
    const seenUrls = new Set<string>();
    const videoResults: { title: string; url: string; source: string; description: string; priority: number }[] = [];
    const articleResults: { title: string; url: string; source: string; description: string; priority: number }[] = [];

    for (const result of searchResults) {
      if (result.status !== "fulfilled") continue;
      for (const item of result.value) {
        if (seenUrls.has(item.url)) continue;
        seenUrls.add(item.url);
        const source = getDomainLabel(item.url);
        const category = classifyResult(item.url, source);
        const entry = {
          title: item.title,
          url: item.url,
          source,
          description: item.description,
          priority: getDomainPriority(item.url),
        };
        if (category === "video") {
          videoResults.push(entry);
        } else {
          articleResults.push(entry);
        }
      }
    }

    // Sort each by domain priority, take top 4
    videoResults.sort((a, b) => a.priority - b.priority);
    articleResults.sort((a, b) => a.priority - b.priority);
    const videos = videoResults.slice(0, 4).map(({ priority: _, ...rest }) => rest);
    const articles = articleResults.slice(0, 4).map(({ priority: _, ...rest }) => rest);

    if (!videos.length && !articles.length) {
      return jsonRes({ videos: [], articles: [], subjects, message: "No results found" });
    }

    return jsonRes({ videos, articles, subjects });
  })
);
