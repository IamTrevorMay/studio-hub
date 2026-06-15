import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

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

function parseSSE(text: string) {
  const lines = text.split("\n");
  let lastData: string | null = null;
  for (const line of lines) {
    if (line.startsWith("data: ")) lastData = line.slice(6).trim();
    else if (line.startsWith("data:")) lastData = line.slice(5).trim();
  }
  if (lastData) return JSON.parse(lastData);
  return JSON.parse(text);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── Auth ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ ok: false, error: "Unauthorized" }, 401);

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data, error: userError } = await sb.auth.getUser();
    if (userError || !data?.user) return json({ ok: false, error: "Not authenticated" }, 401);

    // ── Parse body ──
    const body = await req.json();
    const question = (body.question || "").trim();
    if (!question) return json({ ok: false, error: "Missing question" }, 400);

    // ── Step 1: Claude NL → SQL ──
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) return json({ ok: false, error: "ANTHROPIC_API_KEY not configured" });

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
      return json({ ok: false, error: `Claude API error: ${claudeRes.status}`, detail: errText });
    }

    const claudeData = await claudeRes.json();
    const sql = (claudeData.content?.[0]?.text || "").trim();

    if (!sql || !sql.toUpperCase().startsWith("SELECT")) {
      return json({ ok: false, error: "Failed to generate valid SQL", generated: sql });
    }

    // ── Step 2: Triton MCP — init session ──
    let msgId = 0;
    const initRes = await fetch(TRITON_MCP, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++msgId,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "mayday-stats-query", version: "1.0" },
        },
      }),
    });

    const sessionId = initRes.headers.get("mcp-session-id");
    if (!sessionId) {
      const initText = await initRes.text();
      return json({ ok: false, error: "MCP session failed", detail: initText.slice(0, 500) });
    }

    // ── Step 3: Triton MCP — execute SQL ──
    const queryRes = await fetch(TRITON_MCP, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "mcp-session-id": sessionId,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++msgId,
        method: "tools/call",
        params: { name: "query_database", arguments: { sql } },
      }),
    });

    const queryText = await queryRes.text();
    const parsed = parseSSE(queryText);
    if (parsed.error) {
      return json({ ok: false, error: parsed.error.message || "Triton query failed", detail: JSON.stringify(parsed.error) });
    }

    return json({ ok: true, sql, result: parsed.result || parsed });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: message });
  }
});
