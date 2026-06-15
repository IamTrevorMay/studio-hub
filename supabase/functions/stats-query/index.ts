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

const SYSTEM_PROMPT = `You are a SQL assistant for a baseball Statcast database (PostgreSQL, Triton).
The user asks natural-language questions about baseball stats. You MUST reply with ONLY a single SELECT query — no explanation, no markdown fences, no commentary. Just raw SQL.

Tables and key columns:

1. pitches (7.4M+ rows, 2015–2026, one row per pitch)
   Identity: pitcher (int, MLB ID), batter (int), player_name (text), game_pk (bigint), game_date (date), game_year (int), game_type (text: R/S/P/D/L/W/F/E), inning, inning_topbot (Top/Bot), at_bat_number, home_team, away_team, p_throws (L/R), stand (L/R)
   Pitch type: pitch_type (FF=4-Seam, SI=Sinker, FC=Cutter, SL=Slider, CU=Curveball, CH=Changeup, SW=Swiper, KC=Knuckle Curve, FS=Splitter, ST=Sweeper)
   Release/movement: release_speed (mph), release_spin_rate (rpm), release_extension (ft), arm_angle (deg), pfx_x (horizontal break ft), pfx_z (vertical break ft)
   Location: plate_x (ft, 0=center), plate_z (ft), sz_bot, sz_top, zone (1-9 strike zone, 11-14 out of zone)
   Outcome: type (B=Ball, S=Strike, X=In play), description (swinging_strike, called_strike, ball, foul, hit_into_play, etc.), events (strikeout, walk, single, double, triple, home_run, field_out, etc.)
   Batted ball: launch_speed (exit velo mph), launch_angle (deg), launch_speed_angle (1-6, 6=barrel), bb_type (ground_ball, fly_ball, line_drive, popup), hit_distance_sc (ft)
   Swing tracking: bat_speed (mph), swing_length (ft), attack_angle (deg)
   Expected stats: estimated_ba_using_speedangle (xBA), estimated_woba_using_speedangle (xwOBA), estimated_slg_using_speedangle (xSLG), woba_value, delta_run_exp (RE24)
   Advanced: stuff_plus, location_plus

2. milb_pitches (MiLB, 2023+, same columns as pitches)
   NOTE: events uses Title Case (Strikeout, Home Run) vs MLB lowercase

3. players (~4000 rows)
   id (int, MLB ID), name (text, full name), position (text: RHP, LHP, C, INF, OF, etc.)

4. pitcher_season_command (one row per pitcher × pitch_type × year)
   pitcher, game_year, pitch_type, pitch_name, pitches (count)
   Raw: avg_brink, avg_cluster, avg_cluster_r, avg_cluster_l, avg_hdev, avg_vdev, avg_missfire, close_pct, waste_pct
   Plus (normalized to 100): cmd_plus, rpcom_plus, brink_plus, cluster_plus, cluster_r_plus, cluster_l_plus, hdev_plus, vdev_plus, missfire_plus, close_pct_plus

5. pitcher_season_deception (2017+, one row per pitcher × pitch_type × year)
   pitcher, game_year, pitch_type, pitch_name, pitches, deception_score, unique_score, avg_vaa, avg_haa, avg_vb, avg_hb, avg_ext, z_vaa, z_haa, z_vb, z_hb, z_ext

6. league_averages (50th percentile benchmarks)
   season, level (mlb/milb), role (sp/rp/hitter), metric (text), value (float)

7. player_season_stats (traditional stats, 2015+)
   player_id, season, stat_group, era, w, l, sv, hld, ip, er, r, rbi, sb

8. game_umpires
   game_pk, game_date, hp_umpire (text)

Rules:
- Output ONLY the SELECT statement. Nothing else.
- Do NOT end with a semicolon.
- Do NOT wrap in markdown code fences.
- Do NOT use table aliases. Always use full table names (e.g. pitches.pitcher, players.name — never p.pitcher or pl.name).
- Always LIMIT results (default 25 unless the user specifies).
- JOIN players table (players.id = pitches.pitcher or pitches.batter) when the user asks for player names.
- Use game_year for season filtering, not EXTRACT from game_date.
- Use current year (2026) for "this season" unless specified.
- For pitcher name lookups, JOIN players ON players.id = pitches.pitcher.
- Exclude pitch_type IN ('PO','IN') for pitching analysis (pitchouts, intentional balls).
- PERFORMANCE: The pitches table has 7.4M+ rows. ALWAYS filter by game_year and/or pitcher/batter to avoid full table scans. Never query pitches without a WHERE clause that narrows the dataset.
- When comparing across many players (leaderboards), use a subquery or CTE that filters pitches by game_year first, then aggregate.
- Prefer pitcher_season_command, pitcher_season_deception, player_season_stats, or league_averages for season-level stats instead of aggregating raw pitches when possible.`;

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
    if (!authHeader) return json({ ok: false, error: "Unauthorized" });

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data, error: userError } = await sb.auth.getUser();
    if (userError || !data?.user) return json({ ok: false, error: "Not authenticated" });

    // ── Parse body ──
    const body = await req.json();
    const question = (body.question || "").trim();
    if (!question) return json({ ok: false, error: "Missing question" });

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) return json({ ok: false, error: "ANTHROPIC_API_KEY not configured" });

    // ── Step 1: Claude NL → SQL ──
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: Deno.env.get("CLAUDE_MODEL") || "claude-haiku-4-5",
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
    let sql = (claudeData.content?.[0]?.text || "").trim();

    // Strip markdown fences and trailing semicolons
    sql = sql.replace(/^```(?:sql)?\n?/i, "").replace(/\n?```$/g, "").trim();
    sql = sql.replace(/;\s*$/, "").trim();

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
    // consume init body
    await initRes.text();

    // ── Step 3: Triton MCP — execute SQL ──
    // Always use long timeout — pitches table is 7.4M+ rows
    const queryArgs: Record<string, unknown> = { sql, long: true };

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
        params: { name: "query_database", arguments: queryArgs },
      }),
    });

    const queryText = await queryRes.text();
    const parsed = parseSSE(queryText);

    // Check for JSON-RPC level error
    if (parsed.error) {
      return json({
        ok: false,
        error: parsed.error.message || "Triton query failed",
        sql,
        detail: JSON.stringify(parsed.error),
      });
    }

    // Check for MCP tool-level error (isError in result)
    const result = parsed.result || parsed;
    if (result.isError) {
      const errText = result.content?.map((c: { text?: string }) => c.text).join(" ") || "Query execution failed";
      return json({ ok: false, error: `Query failed: ${errText}`, sql });
    }

    // Extract raw data from MCP result
    let dataText = "";
    const content = result.content || [];
    for (const block of content) {
      if (block.type === "text") dataText += block.text + "\n";
    }

    // ── Step 4: Claude summarizes results in plain language ──
    const summarizeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: Deno.env.get("CLAUDE_MODEL") || "claude-haiku-4-5",
        max_tokens: 1024,
        system: `You are a knowledgeable baseball analyst. The user asked a question about baseball stats, a SQL query was run, and you are given the results. Summarize the data in plain, conversational language. Be concise but informative. Use player names, round numbers nicely, and highlight interesting findings. Do not mention SQL or databases — just answer the question naturally as if you looked it up yourself.`,
        messages: [{
          role: "user",
          content: `Question: ${question}\n\nQuery results:\n${dataText}`,
        }],
      }),
    });

    let answer = dataText; // fallback to raw data if summarization fails
    if (summarizeRes.ok) {
      const sumData = await summarizeRes.json();
      const sumText = (sumData.content?.[0]?.text || "").trim();
      if (sumText) answer = sumText;
    }

    return json({ ok: true, sql, answer, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: message });
  }
});
