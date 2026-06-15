import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TRITON_MCP = "https://mcp.tritonapex.io/mcp";

const SYSTEM_PROMPT = `You are a SQL assistant for a baseball Statcast database (PostgreSQL).
The user asks natural-language questions about baseball stats. You MUST reply with ONLY a single SELECT query — no explanation, no markdown fences, no commentary. Just raw SQL.

Key tables and columns you can use:
- statcast_pitches: pitch-level data (pitcher_id, batter_id, game_date, pitch_type, release_speed, release_spin_rate, pfx_x, pfx_z, plate_x, plate_z, launch_speed, launch_angle, hit_distance_sc, events, description, zone, balls, strikes, stand, p_throws, type, bb_type, woba_value, estimated_woba_using_speedangle, barrel)
- statcast_batting: aggregated batter season stats
- statcast_pitching: aggregated pitcher season stats
- players: player_id, name_first, name_last, birth_year, throws, bats, debut, final_game, primary_position

Common metrics:
- K/9 = (strikeouts / innings_pitched) * 9
- ERA, WHIP, batting average, OPS, wOBA, barrel%, exit velocity, etc.
- Use current year for "this season" unless specified

Rules:
- Output ONLY the SELECT statement. Nothing else.
- Always LIMIT results (default 25 unless the user specifies).
- Use double quotes for column names only if they contain special characters.
- JOIN players table when the user asks for player names.`;

// ─── MCP session management ───
let mcpSessionId: string | null = null;
let mcpMsgId = 0;

function parseSSE(text: string): any {
  const lines = text.split("\n");
  let lastData: string | null = null;
  for (const line of lines) {
    if (line.startsWith("data: ")) lastData = line.slice(6).trim();
    else if (line.startsWith("data:")) lastData = line.slice(5).trim();
  }
  if (lastData) return JSON.parse(lastData);
  return JSON.parse(text);
}

async function mcpRpc(method: string, params: Record<string, any> = {}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (mcpSessionId) headers["mcp-session-id"] = mcpSessionId;

  const res = await fetch(TRITON_MCP, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++mcpMsgId,
      method,
      params,
    }),
  });

  const sid = res.headers.get("mcp-session-id");
  if (sid) mcpSessionId = sid;

  const text = await res.text();
  return parseSSE(text);
}

async function ensureSession() {
  if (mcpSessionId) return;
  await mcpRpc("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "mayday-stats-query", version: "1.0" },
  });
}

async function callTritonSQL(sql: string) {
  await ensureSession();
  const result = await mcpRpc("tools/call", {
    name: "query_database",
    arguments: { sql },
  });
  if (result.error) throw new Error(result.error.message || JSON.stringify(result.error));
  return result.result || result;
}

// ─── Main handler ───
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userError } = await sb.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Not authenticated" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const question = (body.question || "").trim();
    if (!question) {
      return new Response(
        JSON.stringify({ error: "Missing question" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 1: Ask Claude to generate SQL
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      return new Response(
        JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: question }],
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      return new Response(
        JSON.stringify({ error: `Claude API error: ${claudeRes.status}`, detail: errText }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const claudeData = await claudeRes.json();
    const sql = (claudeData.content?.[0]?.text || "").trim();

    if (!sql || !sql.toUpperCase().startsWith("SELECT")) {
      return new Response(
        JSON.stringify({ error: "Failed to generate valid SQL", generated: sql }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 2: Execute SQL via Triton MCP
    const tritonResult = await callTritonSQL(sql);

    return new Response(
      JSON.stringify({ sql, result: tritonResult }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
