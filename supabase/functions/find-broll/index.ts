// supabase/functions/find-broll/index.ts
// Deploy with: supabase functions deploy find-broll --no-verify-jwt
// Analyzes beat text via Claude, then searches Brave for B-Roll suggestions.
// Returns results from Baseball Savant, MLB.com, and YouTube only.

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
  "baseballsavant.mlb.com": 0,
  "mlb.com": 1,
  "youtube.com": 2,
};

function getDomainLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host.includes("baseballsavant.mlb.com")) return "savant";
    if (host.includes("mlb.com")) return "mlb";
    if (host.includes("youtube.com") || host.includes("youtu.be")) return "youtube";
    return "other";
  } catch {
    return "other";
  }
}

function getDomainPriority(url: string): number {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    // Check savant first (it's a subdomain of mlb.com)
    if (host.includes("baseballsavant.mlb.com")) return 0;
    for (const [domain, priority] of Object.entries(DOMAIN_PRIORITY)) {
      if (host.includes(domain)) return priority;
    }
  } catch {
    // ignore
  }
  return 99;
}

/** Classify a result by source — savant=pitch, mlb/youtube=video, other=null (discard) */
function classifyResult(source: string): "pitch" | "video" | null {
  if (source === "savant") return "pitch";
  if (source === "mlb" || source === "youtube") return "video";
  return null;
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

    const model = Deno.env.get("CLAUDE_MODEL") || "claude-sonnet-4-6";

    // ── Step 1: Claude extracts subjects + search terms ──
    let subjects: string[] = [];
    let terms: string[] = [];

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
          max_tokens: 512,
          system: `You extract key subjects and search terms from baseball video script beats. Given a beat (a short script segment about baseball/MLB), identify the key subjects (players, teams, plays, games) and generate 2-3 short search terms that capture the key topics. Each term should be a few words like "Shohei Ohtani pitch mix" or "Aaron Judge home run 2024". Return ONLY valid JSON: { "subjects": ["..."], "terms": ["..."] }`,
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
      terms = (parsed.terms || []).slice(0, 3);

      if (!terms.length) {
        return jsonRes({ results: [], subjects, message: "No search terms generated" });
      }
    } catch (err) {
      clearTimeout(claudeTimeout);
      if (err.name === "AbortError") {
        return jsonRes({ error: "Claude analysis timed out" }, 504);
      }
      console.error("Claude analysis error:", err);
      return jsonRes({ error: "Claude analysis failed" }, 502);
    }

    // Build site:-scoped queries programmatically (3 terms × 3 sites = up to 9)
    const queries: string[] = [];
    for (const term of terms) {
      queries.push(`site:baseballsavant.mlb.com ${term}`);
      queries.push(`site:mlb.com ${term} video highlights`);
      queries.push(`site:youtube.com ${term} highlights`);
    }

    // ── Step 2: Brave Search ──
    const searchResults = await Promise.allSettled(
      queries.map(async (query) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        try {
          const params = new URLSearchParams({ q: query, count: "10" });
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

    // ── Step 3: Deduplicate, classify, and filter to savant/mlb/youtube only ──
    let totalRaw = 0;
    for (const r of searchResults) {
      if (r.status === "fulfilled") totalRaw += r.value.length;
    }
    console.log(`Brave returned ${totalRaw} raw results from ${queries.length} queries`);

    const seenUrls = new Set<string>();
    const allResults: { title: string; url: string; source: string; category: string; description: string; priority: number }[] = [];

    for (const result of searchResults) {
      if (result.status !== "fulfilled") continue;
      for (const item of result.value) {
        if (seenUrls.has(item.url)) continue;
        seenUrls.add(item.url);
        const source = getDomainLabel(item.url);
        const category = classifyResult(source);
        if (!category) continue; // discard non-savant/mlb/youtube results
        allResults.push({
          title: item.title,
          url: item.url,
          source,
          category,
          description: item.description,
          priority: getDomainPriority(item.url),
        });
      }
    }

    // Sort by domain priority, then pick up to 2 per source (6 max)
    allResults.sort((a, b) => a.priority - b.priority);
    const counts: Record<string, number> = {};
    const results = allResults
      .filter(r => {
        counts[r.source] = (counts[r.source] || 0) + 1;
        return counts[r.source] <= 2;
      })
      .slice(0, 6)
      .map(({ priority: _, ...rest }) => rest);

    console.log(`After filtering: ${allResults.length} matched domains, returning ${results.length}`);
    if (allResults.length === 0 && totalRaw > 0) {
      // Log sample URLs so we can see what Brave actually returned
      const sampleUrls: string[] = [];
      for (const r of searchResults) {
        if (r.status === "fulfilled") {
          for (const item of r.value) {
            if (sampleUrls.length < 5) sampleUrls.push(item.url);
          }
        }
      }
      console.log("Sample URLs from Brave (all filtered out):", sampleUrls);
    }

    if (!results.length) {
      return jsonRes({ results: [], subjects, message: "No results found" });
    }

    return jsonRes({ results, subjects });
  })
);
