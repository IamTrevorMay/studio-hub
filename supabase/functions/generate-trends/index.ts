import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Allow both cron (secret-based) and authenticated user calls
    const url = new URL(req.url);
    const cronSecret = url.searchParams.get("secret") || req.headers.get("x-cron-secret");
    const expectedSecret = Deno.env.get("CRON_SECRET");
    const authHeader = req.headers.get("Authorization");

    let userId: string | null = null;

    if (expectedSecret && cronSecret === expectedSecret) {
      // Cron invocation — no user context needed
    } else if (authHeader) {
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: { user }, error: userError } = await userClient.auth.getUser();
      if (userError || !user) {
        return new Response(
          JSON.stringify({ error: "Not authenticated" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      userId = user.id;
    } else {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      return new Response(
        JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Fetch recent articles from the last 48 hours (news + newsletter feeds)
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - 48);

    const { data: articles, error: articlesError } = await adminClient
      .from("research_articles")
      .select("id, title, description, content, author, pub_date, feed:research_feeds(id, name, source_type)")
      .gte("pub_date", cutoff.toISOString())
      .order("pub_date", { ascending: false })
      .limit(500);

    if (articlesError) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch articles: " + articlesError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch all enabled feeds to infer content niche
    const { data: feeds } = await adminClient
      .from("research_feeds")
      .select("name, url, source_type")
      .eq("enabled", true);

    if (!articles || articles.length === 0) {
      return new Response(
        JSON.stringify({ error: "No recent articles found to analyze" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build content for Claude
    const feedList = (feeds || []).map(f => `- ${f.name} (${f.source_type}): ${f.url}`).join("\n");

    let contentSummary = "";
    for (const a of articles) {
      const feedName = a.feed?.name || "Unknown";
      const feedType = a.feed?.source_type || "news";
      const desc = (a.description || a.content || "")
        .replace(/<[^>]*>/g, "")
        .substring(0, 400);
      contentSummary += `- **${a.title}** [${feedName}, ${feedType}] ${desc}\n`;
    }

    const today = new Date().toISOString().slice(0, 10);

    const prompt = `You are a trends analyst for a content creator. Your job is to analyze recent articles and newsletters, identify what's trending, and suggest content topics.

## The creator's content niche
Infer what this creator covers based on their subscribed sources:
${feedList}

## Recent articles and newsletters (last 48 hours)
${contentSummary}

## Your task
Analyze all the content above and produce a trends report in the following JSON structure. Be specific and actionable.

{
  "summary": "A 2-3 sentence overview of the key trends and themes across all sources today.",
  "current_events": [
    {
      "title": "Short topic title",
      "angle": "A specific content angle the creator could take on this topic",
      "reasoning": "Why this topic matters right now and why it would resonate with an audience",
      "priority": "high | medium | low",
      "sources": ["Source Name 1", "Source Name 2"]
    }
  ],
  "evergreen": [
    {
      "title": "Short topic title",
      "angle": "A specific content angle",
      "reasoning": "Why this is a strong evergreen topic based on recurring themes in the sources",
      "priority": "high | medium | low",
      "sources": ["Source Name 1"]
    }
  ],
  "suggestions": [
    {
      "title": "Specific content topic suggestion",
      "description": "A 1-2 sentence pitch for this content piece",
      "grade": "A+ | A | A- | B+ | B | B- | C+ | C | C- | D+ | D | D- | F",
      "reasoning": "Why this grade — based on how much it's being talked about across sources and how well it fits what the creator covers"
    }
  ]
}

Rules:
- Include 3-6 current events, 2-4 evergreen topics, and exactly 5 suggestions
- Suggestions should be graded A+ to F: A+ means extremely high buzz AND perfect niche fit, F means low buzz or poor fit
- Be honest with grades — not everything is an A
- The angle should be specific enough to start creating content from immediately
- Only return valid JSON, no markdown code fences or extra text`;

    // Call Claude API
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);

    let claudeResponse;
    try {
      claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: Deno.env.get("CLAUDE_MODEL") || "claude-sonnet-4-20250514",
          max_tokens: 4096,
          messages: [{ role: "user", content: prompt }],
        }),
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!claudeResponse.ok) {
      const errBody = await claudeResponse.text();
      return new Response(
        JSON.stringify({ error: "Claude API error: " + errBody }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const claudeData = await claudeResponse.json();
    const rawText = claudeData.content?.[0]?.text || "";

    // Parse JSON from response (handle possible markdown code fences)
    const jsonStr = rawText.replace(/^```json?\s*/i, "").replace(/\s*```$/i, "").trim();
    let report;
    try {
      report = JSON.parse(jsonStr);
    } catch {
      return new Response(
        JSON.stringify({ error: "Failed to parse Claude response as JSON", raw: rawText }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Upsert into research_trends
    const { error: upsertError } = await adminClient
      .from("research_trends")
      .upsert(
        {
          date: today,
          summary: report.summary || "",
          current_events: report.current_events || [],
          evergreen: report.evergreen || [],
          suggestions: report.suggestions || [],
          source_count: articles.length,
        },
        { onConflict: "date" }
      );

    if (upsertError) {
      return new Response(
        JSON.stringify({ error: "Failed to save trends: " + upsertError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        date: today,
        summary: report.summary,
        current_events_count: (report.current_events || []).length,
        evergreen_count: (report.evergreen || []).length,
        suggestions_count: (report.suggestions || []).length,
        source_count: articles.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
