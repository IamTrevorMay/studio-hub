// supabase/functions/generate-section/index.ts
// Deploy with: supabase functions deploy generate-section --no-verify-jwt
// Given a free-text description, uses Claude to produce a section spec
// (name, data_source, prompt_template) and runs a live preview against real data.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchSectionSource, resolvePrompt } from "../shared/report-sources.ts";

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

const SOURCE_REFERENCE = `Available data source types (pick exactly one):

1. "rss" — Recent articles from the research_feeds table.
   config: { "feed_ids": string[] (empty array = all feeds), "time_window_hours": number (default 48) }
   Variables exposed: {{articles}} (markdown-bulleted list), {{feed_names}}, {{source_count}}

2. "triton_brief" — The latest daily pitching brief from Triton.
   config: {} (or { "date": "YYYY-MM-DD" } for a specific day)
   Variables exposed: {{brief_title}}, {{brief_summary}}, {{brief_content}} (HTML), {{brief_badges}} (HTML), {{brief_date}}

3. "triton_api" — Generic HTTP call to a Triton Apex endpoint.
   config: { "endpoint": string, "method": "GET"|"POST", "params": string (JSON) }
   Variables exposed: {{triton_data}} (raw response body)

4. "supabase_query" — Query a table in the main Supabase project.
   config: { "table": string, "select": string, "filters": string (JSON array), "limit": number, "order_by": string }
   Variables exposed: {{query_results}} (JSON), {{source_count}}

Always available: {{date}}, {{section_name}}`;

async function callClaudeForSpec(description: string): Promise<any> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

  const system = `You design reusable report sections for a content production dashboard. Given a user's description, you output a section spec as JSON.

${SOURCE_REFERENCE}

Return JSON with this exact shape:
{
  "name": "short title (3-5 words)",
  "description": "one sentence describing what this section shows",
  "kind": "custom",
  "data_source": { "type": "...", "config": {...} },
  "prompt_template": "an instruction to Claude that uses {{variables}} from the chosen source to produce an HTML fragment with inline styles. Must be a complete standalone prompt."
}

Rules:
- prompt_template must reference the variables exposed by the chosen data source using {{handlebars}} syntax
- prompt_template should ask for an HTML fragment with inline styles matching a dark theme (#0f0f1a bg, white text, #6366f1 accent)
- Keep output concise and visually scannable
- Return only valid JSON. No markdown fences, no commentary.`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2048,
        system,
        messages: [{ role: "user", content: description }],
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Claude API ${resp.status}: ${errText.slice(0, 300)}`);
    }
    const data = await resp.json();
    const raw = (data.content?.[0]?.text || "").trim();
    const cleaned = raw.replace(/^```json?\s*/i, "").replace(/\s*```$/i, "").trim();
    return JSON.parse(cleaned);
  } finally {
    clearTimeout(timeout);
  }
}

async function renderPreviewHtml(prompt: string): Promise<string> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY")!;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 3072,
        messages: [{
          role: "user",
          content: prompt + "\n\nReturn only the HTML fragment (no <html>, <head>, <body>, no markdown code fences, no commentary). Use inline styles.",
        }],
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Claude API ${resp.status}: ${errText.slice(0, 300)}`);
    }
    const data = await resp.json();
    const raw = (data.content?.[0]?.text || "").trim();
    return raw.replace(/^```html?\s*/i, "").replace(/\s*```$/i, "").trim();
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResp({ error: "Unauthorized" }, 401);

  try {
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return jsonResp({ error: "Unauthorized" }, 401);
    const { data: profile } = await userClient
      .from("profiles").select("role").eq("id", user.id).single();
    if (profile?.role !== "admin") return jsonResp({ error: "Admin access required" }, 403);
  } catch {
    return jsonResp({ error: "Unauthorized" }, 401);
  }

  let body: any;
  try { body = await req.json(); } catch { return jsonResp({ error: "Invalid JSON body" }, 400); }

  const { description } = body;
  if (!description || typeof description !== "string") {
    return jsonResp({ error: "description is required" }, 400);
  }

  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // 1. Ask Claude to design the section spec
    const spec = await callClaudeForSpec(description);

    if (!spec.data_source || !spec.prompt_template) {
      return jsonResp({ error: "Generated spec is incomplete", spec }, 502);
    }

    // 2. Fetch live data for the designed source
    const sourceResult = await fetchSectionSource(adminClient, spec.data_source);
    sourceResult.variables.date = new Date().toISOString().slice(0, 10);
    sourceResult.variables.section_name = spec.name || "";

    // 3. Run the prompt against real data to produce preview HTML
    const resolvedPrompt = resolvePrompt(spec.prompt_template, sourceResult.variables);
    const previewHtml = await renderPreviewHtml(resolvedPrompt);

    return jsonResp({
      spec: {
        name: spec.name || "Untitled Section",
        description: spec.description || "",
        kind: spec.kind || "custom",
        data_source: spec.data_source,
        prompt_template: spec.prompt_template,
        render_template: "",
      },
      preview_html: previewHtml,
      source_count: sourceResult.sourceCount,
    });
  } catch (err: any) {
    return jsonResp({ error: err.message || String(err) }, 500);
  }
});
