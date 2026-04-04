// supabase/functions/preview-report/index.ts
// Deploy with: supabase functions deploy preview-report --no-verify-jwt
// Stateless preview: fetches data from sources, calls Claude with conversation, returns HTML.
// Does NOT write to report_runs. Used by the editor's conversational prompt UI.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchAllSources } from "../shared/report-sources.ts";

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth: user bearer token only
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
  } catch {
    return jsonResp({ error: "Unauthorized" }, 401);
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return jsonResp({ error: "ANTHROPIC_API_KEY not configured" }, 500);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResp({ error: "Invalid JSON body" }, 400);
  }

  const { data_sources, instruction, conversation_history } = body;

  if (!instruction) {
    return jsonResp({ error: "instruction is required" }, 400);
  }

  if (!data_sources || !Array.isArray(data_sources) || data_sources.length === 0) {
    return jsonResp({ error: "At least one data source is required" }, 400);
  }

  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // Fetch data from all configured sources
    const sourceResult = await fetchAllSources(adminClient, data_sources);
    const today = new Date().toISOString().slice(0, 10);
    sourceResult.variables.date = today;

    // Build data context block
    const dataContext = Object.entries(sourceResult.variables)
      .map(([key, val]) => `## ${key}\n${val}`)
      .join("\n\n");

    // Build Claude messages
    const systemPrompt = `You are a report generator for a content production team. You generate HTML reports based on user instructions and provided data.

Here is the data available for this report:

${dataContext}

Rules:
- Generate the report as clean HTML (no <html>, <head>, or <body> tags — just the content)
- Use inline styles for formatting
- Be conversational and professional
- Follow the user's instructions precisely

In addition to the HTML report, also generate a "compiled_prompt" — a standalone instruction template that could reproduce this report given fresh data. Use these placeholders: {{articles}}, {{feed_names}}, {{date}}, {{source_count}}, {{triton_data}}, {{query_results}}

Return your response as JSON: { "html": "...", "compiled_prompt": "..." }
Only return valid JSON, no markdown code fences or extra text.`;

    // Build conversation messages
    const messages: { role: string; content: string }[] = [];

    // Add previous conversation turns if any
    if (conversation_history && Array.isArray(conversation_history)) {
      for (const msg of conversation_history) {
        if (msg.role === "user") {
          messages.push({ role: "user", content: msg.content });
        } else if (msg.role === "assistant") {
          messages.push({ role: "assistant", content: msg.content });
        }
      }
    }

    // Add current instruction
    messages.push({ role: "user", content: instruction });

    // Call Claude
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
          max_tokens: 4096,
          system: systemPrompt,
          messages,
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        return jsonResp({ error: `Claude API ${resp.status}: ${errText.slice(0, 300)}` }, 502);
      }

      const data = await resp.json();
      const rawText = data.content?.[0]?.text || "";
      const jsonStr = rawText
        .replace(/^```json?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

      try {
        const parsed = JSON.parse(jsonStr);
        return jsonResp({
          html: parsed.html || "",
          compiled_prompt: parsed.compiled_prompt || "",
          source_count: sourceResult.sourceCount,
          raw_response: rawText,
        });
      } catch {
        // If JSON parse fails, treat the whole response as HTML
        return jsonResp({
          html: rawText,
          compiled_prompt: "",
          source_count: sourceResult.sourceCount,
          raw_response: rawText,
        });
      }
    } finally {
      clearTimeout(timeout);
    }
  } catch (err: any) {
    return jsonResp({ error: err.message || String(err) }, 500);
  }
});
