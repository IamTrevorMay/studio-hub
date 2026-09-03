// supabase/functions/generate-ashley-read/index.ts
// Ashley's weekly tactical Analytics read. Runs every Saturday via pg_cron
// (covers the 7 days Sat..Fri that just ended) alongside generate-weekly-report,
// and can be invoked by an admin ("Refresh") to spin a fresh working version.
//
// Aggregates per SURFACE — yt_long (YouTube long-form + channel-daily retention),
// yt_short (YouTube Shorts, content-level only), tiktok (account-level reach/
// engagement only) — then asks Claude (as Ashley, grounded in her vendored brain
// docs) for tactical, benchmarked, per-point diagnostics. INSERTS a new versioned
// row into ashley_reads (never upserts) so a Save-pinned/actioned read is never
// clobbered by a later Refresh.
//
// Auth: CRON_SECRET (?secret= / X-Cron-Secret / Bearer) for cron, or an admin JWT.
// Body (optional): { week_start: "YYYY-MM-DD" }.  Ashley never emails.
// Deploy: supabase functions deploy generate-ashley-read --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ASHLEY_BRAIN } from "./brain.ts";

// Admin tier = admin + director (mirrors the DB is_admin() helper and the
// client-side isAdminTier). Directors are restricted in the UI, not here.
const ADMIN_TIER = ["admin", "director"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL = Deno.env.get("CLAUDE_MODEL") || "claude-sonnet-4-6";

function jsonResp(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function admin(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

// ── date helpers ─────────────────────────────────────────────
function ymd(d: Date): string { return d.toISOString().slice(0, 10); }
function ptDayString(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}
// PT hour-of-day (0..23) for a timestamptz — used to bucket posts into dayparts.
function ptHour(d: Date): number {
  const s = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles", hour: "2-digit", hour12: false,
  }).format(d);
  const h = parseInt(s, 10);
  return h === 24 ? 0 : h;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}
function inRange(dateStr: string, start: string, end: string): boolean {
  return dateStr >= start && dateStr <= end;
}
function pctChange(cur: number, base: number): number | null {
  if (base === 0) return cur === 0 ? 0 : null;
  return Math.round(((cur - base) / Math.abs(base)) * 1000) / 10;
}
function median(nums: number[]): number {
  const a = nums.filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return 0;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : Math.round((a[mid - 1] + a[mid]) / 2);
}
function round(n: number, p = 1): number {
  const f = 10 ** p;
  return Math.round(n * f) / f;
}
// Weighted average, ignoring null values and zero weights. Returns null if no data.
function wavg(pairs: Array<[number | null, number]>): number | null {
  let num = 0, den = 0;
  for (const [v, w] of pairs) {
    if (v === null || v === undefined || !Number.isFinite(v) || w <= 0) continue;
    num += v * w; den += w;
  }
  return den > 0 ? round(num / den, 2) : null;
}

const DAYPARTS: Array<[string, number, number]> = [
  ["late night 12-5am", 0, 5],
  ["early morning 5-9am", 5, 9],
  ["morning 9am-12pm", 9, 12],
  ["midday 12-3pm", 12, 15],
  ["afternoon 3-6pm", 15, 18],
  ["evening 6-9pm", 18, 21],
  ["night 9pm-12am", 21, 24],
];
function daypartOf(hour: number): string {
  for (const [label, lo, hi] of DAYPARTS) if (hour >= lo && hour < hi) return label;
  return "night 9pm-12am";
}
// Best 1-2 dayparts by median views across a set of dated items.
function bestDayparts(items: Array<{ published_at: string; views: number }>): string[] {
  const buckets = new Map<string, number[]>();
  for (const it of items) {
    if (!it.published_at) continue;
    const dp = daypartOf(ptHour(new Date(it.published_at)));
    (buckets.get(dp) || buckets.set(dp, []).get(dp)!).push(it.views);
  }
  return [...buckets.entries()]
    .map(([dp, vs]) => ({ dp, med: median(vs), n: vs.length }))
    .filter((b) => b.n >= 2) // need at least 2 posts to trust a daypart
    .sort((a, b) => b.med - a.med)
    .slice(0, 2)
    .map((b) => `${b.dp} (median ${b.med.toLocaleString()} views, n=${b.n})`);
}

// ── Ashley (Claude) call, cloned from generate-weekly-report ──
const HARD_RULES = `
You are Ashley producing this week's tactical Analytics read for Mayday Media.
You are given a JSON summary of THIS WEEK's data for specific surfaces. Rules:

COVERAGE — never exceed the data:
- yt_long: you MAY diagnose CTR, average_percentage_viewed / average_view_duration_seconds (retention),
  watch time, new-vs-returning mix — but ONLY when the value is present (non-null). If ctr is null, say
  "CTR not measured this period (upload the YouTube Studio CSV)" — NEVER estimate or invent it.
- yt_short: YouTube Shorts. You have views, velocity, subs (channel-level), subs-per-1k. You do NOT have
  CTR, AVD, or a retention curve for Shorts. Do not claim any.
- tiktok: ACCOUNT-LEVEL reach/engagement ONLY — total views, followers + follower delta, likes,
  comments, shares, shares-per-reach, follower conversion. You have NO per-post/per-video TikTok data
  in this app: NO per-video outlier multiples, NO top-post ranking, NO best posting times, and NO
  CTR / AVD / retention / watch-time. Diagnose TikTok at the account level only (is reach growing, is
  engagement converting to followers, is share rate healthy vs benchmark). If you catch yourself about
  to name a specific TikTok video, cite a per-video number, or mention TikTok retention/CTR, delete it.

GROUNDING:
- Every quantitative claim cites the actual number from the summary.
- Compare every number to a benchmark from your brain docs and STATE THE BENCHMARK's date in
  \`benchmark_date\` (platform mechanics age fast; a reader in 2027 must know when this was true).
- \`source_doc\` = the brain doc that grounds the point.
- Outlier multiple = item views ÷ trailing median for that surface. Bands: 2x noteworthy, 3x+
  significant, 20x+ likely a fluke — don't build advice on 20x+.

VOICE & SHAPE:
- title = one glanceable line. detail = the why + the specific fix (a rewrite, a format, a time).
- Packaging-first, platform-native, diagnosed on click→hook→hold→payoff (only the stages the data
  supports per surface).
- 8-10 points max, ≤4 per surface. If a surface is data-sparse, say so in ONE point. No padding.
- Every point's suggested_action must be a concrete next step someone could do this week.

OUTPUT: return ONLY a JSON object of this exact shape, no prose outside it:
{"headline":"one punchy sentence on the week across surfaces","points":[{"surface":"yt_long|yt_short|tiktok","severity":"win|watch|fix","title":"≤120 chars glanceable line","detail":"2-4 sentences: why + specific fix","metric":"the number(s) this rests on, or null","source_doc":"brain doc name","benchmark_date":"YYYY-MM-DD","suggested_action":{"kind":"task|decision","task_title":"actionable imperative","task_notes":"context for the assignee","link_url":"content_items.url of the post, or null"}}]}
`.trim();

const SYSTEM = `${ASHLEY_BRAIN}\n\n${HARD_RULES}`;

async function ashleyRead(summary: unknown): Promise<Record<string, unknown>> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return { _error: "ANTHROPIC_API_KEY not configured" };
  const userPrompt = `Here is this week's data. Produce the read.\n\n${JSON.stringify(summary, null, 2)}\n\nReturn ONLY the JSON object.`;

  for (let attempt = 0; attempt <= 1; attempt++) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 8000, // 8-10 detailed points can exceed 3k and truncate the JSON mid-array
          system: SYSTEM,
          messages: [{ role: "user", content: userPrompt }],
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        console.error(`Claude error (attempt ${attempt})`, res.status, errText);
        if (attempt === 0) { await new Promise((r) => setTimeout(r, 3000)); continue; }
        return { _error: `Claude API ${res.status}` };
      }
      const j = await res.json();
      const text = j?.content?.[0]?.text || "";
      const m = text.match(/\{[\s\S]*\}/);
      return m ? JSON.parse(m[0]) : {};
    } catch (e) {
      console.error(`ashleyRead failed (attempt ${attempt})`, e);
      if (attempt === 0) { await new Promise((r) => setTimeout(r, 3000)); continue; }
      return { _error: String(e instanceof Error ? e.message : e) };
    }
  }
  return { _error: "Exhausted retries" };
}

// ── main ─────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResp({ error: "Method not allowed" }, 405);

  const url = new URL(req.url);
  const cronSecret = Deno.env.get("CRON_SECRET");
  const auth = req.headers.get("Authorization");
  const querySecret = url.searchParams.get("secret");
  const headerSecret = req.headers.get("x-cron-secret");

  const isCron = !!cronSecret &&
    (querySecret === cronSecret || headerSecret === cronSecret || auth === `Bearer ${cronSecret}`);
  let isAdmin = false;

  const db = admin();

  if (!isCron && auth?.startsWith("Bearer ")) {
    const { data: { user } } = await db.auth.getUser(auth.replace("Bearer ", ""));
    if (user) {
      const { data: profile } = await db.from("profiles").select("role").eq("id", user.id).single();
      if (ADMIN_TIER.includes(profile?.role)) isAdmin = true;
    }
  }
  if (!isCron && !isAdmin) return jsonResp({ error: "Unauthorized" }, 401);
  const generated_by = isCron ? "cron" : "admin";

  let body: { week_start?: string } = {};
  try { body = await req.json(); } catch { /* empty body ok */ }

  try {
    // ── window math (clone of weekly-report) ──
    let weekStart: Date, weekEnd: Date;
    if (body.week_start) {
      weekStart = new Date(body.week_start + "T00:00:00Z");
      weekEnd = addDays(weekStart, 6);
    } else {
      weekEnd = addDays(new Date(), -1);
      weekStart = addDays(weekEnd, -6);
    }
    const wkStart = ymd(weekStart), wkEnd = ymd(weekEnd);
    const prevStart = ymd(addDays(weekStart, -7)), prevEnd = ymd(addDays(weekStart, -1));
    const baseStart = ymd(addDays(weekStart, -28)), baseEnd = ymd(addDays(weekStart, -1));

    // ── accounts ──
    const { data: accounts } = await db
      .from("platform_accounts")
      .select("id, platform, account_name, is_active");
    const ytAccounts = (accounts || []).filter((a) => a.platform === "youtube");
    const ttAccounts = (accounts || []).filter((a) => a.platform === "tiktok");

    // ── analytics_youtube_daily (channel-level retention/reach) over 5 weeks ──
    const { data: ytDaily } = await db
      .from("analytics_youtube_daily")
      .select("platform_account_id, date, views, watch_time_hours, impressions, impressions_ctr, average_view_duration_seconds, average_percentage_viewed, subscribers, new_viewers, returning_viewers")
      .gte("date", baseStart).lte("date", wkEnd);

    function ytChannel(acctId: string, start: string, end: string) {
      const rows = (ytDaily || []).filter((r) => r.platform_account_id === acctId && inRange(r.date, start, end));
      const views = rows.reduce((s, r) => s + Number(r.views || 0), 0);
      const watch = rows.reduce((s, r) => s + Number(r.watch_time_hours || 0), 0);
      const impressions = rows.reduce((s, r) => s + Number(r.impressions || 0), 0);
      const ctr = wavg(rows.map((r) => [r.impressions_ctr ?? null, Number(r.impressions || 0)]));
      const avd = wavg(rows.map((r) => [r.average_view_duration_seconds ?? null, Number(r.views || 0)]));
      const avp = wavg(rows.map((r) => [r.average_percentage_viewed ?? null, Number(r.views || 0)]));
      const subs = rows.reduce((s, r) => s + Number(r.subscribers || 0), 0);
      const newV = rows.reduce((s, r) => s + Number(r.new_viewers || 0), 0);
      const retV = rows.reduce((s, r) => s + Number(r.returning_viewers || 0), 0);
      const anyCtr = rows.some((r) => r.impressions_ctr !== null && r.impressions_ctr !== undefined);
      return { views, watch_hours: round(watch, 1), impressions: impressions || null, ctr, avd, avp, subs, newV, retV, anyCtr };
    }

    // ── content_items + latest content_metrics (YouTube per-post) ──
    const contentFetchStart = ymd(addDays(weekStart, -28 - 1));
    const contentFetchEnd = ymd(addDays(weekEnd, 1));
    const { data: itemsRaw } = await db
      .from("content_items")
      .select("id, title, url, platform_account_id, published_at, content_type")
      .gte("published_at", contentFetchStart + "T00:00:00Z")
      .lte("published_at", contentFetchEnd + "T23:59:59Z");
    const ytItems = (itemsRaw || []).filter((i) =>
      ytAccounts.some((a) => a.id === i.platform_account_id) && i.published_at);

    const itemIds = ytItems.map((i) => i.id);
    const metricsByItem = new Map<string, { views: number; likes: number; comments: number; shares: number; er: number }>();
    if (itemIds.length) {
      const { data: cm } = await db
        .from("content_metrics")
        .select("content_item_id, captured_at, views, likes, comments, shares, engagement_rate")
        .in("content_item_id", itemIds);
      const latest = new Map<string, string>();
      for (const r of cm || []) {
        const cur = latest.get(r.content_item_id);
        if (!cur || r.captured_at > cur) {
          latest.set(r.content_item_id, r.captured_at);
          metricsByItem.set(r.content_item_id, {
            views: r.views || 0, likes: r.likes || 0, comments: r.comments || 0,
            shares: r.shares || 0, er: Number(r.engagement_rate || 0),
          });
        }
      }
    }
    // enrich items with latest metrics + PT day
    const enriched = ytItems.map((i) => {
      const m = metricsByItem.get(i.id) || { views: 0, likes: 0, comments: 0, shares: 0, er: 0 };
      return {
        id: i.id, title: i.title || "(untitled)", url: i.url,
        acct: i.platform_account_id, published_at: i.published_at,
        content_type: i.content_type, pt_day: ptDayString(new Date(i.published_at)),
        ...m,
      };
    });

    // Build a YouTube surface block (long or short) for one channel.
    function ytSurface(acct: { id: string; account_name: string }, kind: "yt_long" | "yt_short") {
      const wantType = kind === "yt_long" ? "video" : "short";
      const mine = enriched.filter((e) => e.acct === acct.id && e.content_type === wantType);
      const trailing = mine.filter((e) => inRange(e.pt_day, baseStart, wkEnd)); // 5-week baseline for median
      const med = median(trailing.map((e) => e.views));
      const thisWk = mine.filter((e) => inRange(e.pt_day, wkStart, wkEnd));
      const prevWk = mine.filter((e) => inRange(e.pt_day, prevStart, prevEnd));
      const wkViews = thisWk.reduce((s, e) => s + e.views, 0);
      const prevViews = prevWk.reduce((s, e) => s + e.views, 0);
      const top = [...thisWk].sort((a, b) => b.views - a.views).slice(0, 4).map((e) => ({
        title: e.title, url: e.url, views: e.views,
        outlier_multiple: med > 0 ? round(e.views / med, 1) : null,
        likes: e.likes, comments: e.comments, shares: e.shares,
        engagement_rate: e.er, published_at: e.published_at,
      }));
      const ch = ytChannel(acct.id, wkStart, wkEnd);
      const chPrev = ytChannel(acct.id, prevStart, prevEnd);
      const best = bestDayparts(thisWk.map((e) => ({ published_at: e.published_at, views: e.views })));

      if (kind === "yt_long") {
        return {
          channel: acct.account_name,
          posts_this_week: thisWk.length,
          views: ch.views, views_wow: pctChange(ch.views, chPrev.views),
          watch_hours: ch.watch_hours,
          impressions: ch.impressions,
          ctr: ch.ctr, avg_view_pct: ch.avp, avg_view_duration_s: ch.avd,
          subs_gained: ch.subs, new_viewers: ch.newV, returning_viewers: ch.retV,
          new_vs_returning_ratio: ch.retV > 0 ? round(ch.newV / ch.retV, 2) : null,
          median_views: med, top_items: top, best_dayparts_pt: best,
        };
      }
      return {
        channel: acct.account_name,
        posts_this_week: thisWk.length,
        views: wkViews, views_wow: pctChange(wkViews, prevViews),
        subs_gained: ch.subs, // channel-level (YT gives no per-format subs)
        subs_per_1k_views: wkViews > 0 ? round((ch.subs / wkViews) * 1000, 2) : null,
        median_views: med, top_items: top, best_dayparts_pt: best,
      };
    }

    const yt_long = ytAccounts.map((a) => ytSurface(a, "yt_long"));
    const yt_short = ytAccounts.map((a) => ytSurface(a, "yt_short"));

    // ── TikTok (account-level only) from platform_daily_metrics + audience_snapshots ──
    const { data: pdm } = await db
      .from("platform_daily_metrics")
      .select("platform_account_id, date, views, likes, comments, shares")
      .gte("date", baseStart).lte("date", wkEnd);
    const { data: aud } = await db
      .from("audience_snapshots")
      .select("platform_account_id, date, followers_total, followers_gained")
      .gte("date", baseStart).lte("date", wkEnd);

    function tiktokSurface(acct: { id: string; account_name: string }) {
      const rows = (pdm || []).filter((r) => r.platform_account_id === acct.id);
      const sum = (arr: typeof rows, start: string, end: string, k: "views" | "likes" | "comments" | "shares") =>
        arr.filter((r) => inRange(r.date, start, end)).reduce((s, r) => s + Number(r[k] || 0), 0);
      const wkV = sum(rows, wkStart, wkEnd, "views");
      const prevV = sum(rows, prevStart, prevEnd, "views");
      const likes = sum(rows, wkStart, wkEnd, "likes");
      const comments = sum(rows, wkStart, wkEnd, "comments");
      const shares = sum(rows, wkStart, wkEnd, "shares");
      // followers: latest total ≤ wkEnd; gained summed over week
      const aRows = (aud || []).filter((r) => r.platform_account_id === acct.id);
      let followers_total = 0, fDate = "";
      for (const r of aRows) if (r.date <= wkEnd && r.date > fDate) { fDate = r.date; followers_total = r.followers_total || 0; }
      const followers_gained = aRows.filter((r) => inRange(r.date, wkStart, wkEnd)).reduce((s, r) => s + Number(r.followers_gained || 0), 0);
      return {
        account: acct.account_name,
        views: wkV, views_wow: pctChange(wkV, prevV),
        followers_total, followers_gained,
        likes, comments, shares,
        shares_per_1k_reach: wkV > 0 ? round((shares / wkV) * 1000, 2) : null,
        follower_conv_per_1k_views: wkV > 0 ? round((followers_gained / wkV) * 1000, 2) : null,
      };
    }
    const tiktok = ttAccounts.map(tiktokSurface);

    // ── coverage / completeness ──
    const ctrAvailable = yt_long.some((b, i) => ytChannel(ytAccounts[i].id, wkStart, wkEnd).anyCtr);
    const activeAccts = (accounts || []).filter((a) => a.is_active && (a.platform === "youtube" || a.platform === "tiktok"));
    const expected = activeAccts.length * 7;
    const seen = new Set<string>();
    for (const r of pdm || []) if (inRange(r.date, wkStart, wkEnd)) seen.add(`${r.platform_account_id}|${r.date}`);
    for (const r of ytDaily || []) if (inRange(r.date, wkStart, wkEnd)) seen.add(`${r.platform_account_id}|${r.date}`);
    const data_completeness_pct = expected > 0 ? Math.min(100, Math.round((seen.size / expected) * 100)) : 100;

    const window = { week_start: wkStart, week_end: wkEnd, prev_start: prevStart, prev_end: prevEnd, base_start: baseStart, base_end: baseEnd };
    const summary = {
      window,
      yt_long, yt_short, tiktok,
      coverage: { ctr_available: { yt_long: ctrAvailable }, data_completeness_pct },
    };

    // ── ask Ashley ──
    const ai = await ashleyRead(summary);
    const generation_failed = !!ai._error;
    if (generation_failed) console.warn("Ashley read generation failed:", ai._error);

    const headline = typeof ai.headline === "string" ? ai.headline : null;
    const points = Array.isArray(ai.points) ? ai.points : [];
    const meta = {
      generation_failed,
      ctr_available: ctrAvailable,
      data_completeness_pct,
      ...(generation_failed ? { error: String(ai._error) } : {}),
    };
    const surfaces = ["yt_long", "yt_short", "tiktok"];

    // ── INSERT a new version (never upsert). Race-guarded on the unique index. ──
    let savedId: string | null = null, versionNumber = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: maxRow } = await db
        .from("ashley_reads").select("version_number")
        .eq("week_start", wkStart).order("version_number", { ascending: false }).limit(1).maybeSingle();
      versionNumber = (maxRow?.version_number || 0) + 1;
      const { data: ins, error: insErr } = await db
        .from("ashley_reads")
        .insert({
          week_start: wkStart, week_end: wkEnd, version_number: versionNumber,
          is_saved: false, surfaces, headline, points, meta,
          model: MODEL, generated_by, generated_at: new Date().toISOString(),
        })
        .select("id").single();
      if (!insErr) { savedId = ins?.id ?? null; break; }
      if (insErr.code === "23505") continue; // lost the version race — recompute + retry
      throw insErr;
    }
    if (!savedId) throw new Error("Could not allocate a version_number after retries");

    return jsonResp({
      ok: true, id: savedId, week_start: wkStart, week_end: wkEnd,
      version_number: versionNumber, generated_by, generation_failed, points: points.length,
    });
  } catch (err) {
    console.error("generate-ashley-read error:", err);
    return jsonResp({ error: String(err instanceof Error ? err.message : err) }, 500);
  }
});
