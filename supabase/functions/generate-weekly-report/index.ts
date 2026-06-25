// supabase/functions/generate-weekly-report/index.ts
// Builds the weekly KPI report. Runs every Saturday via pg_cron (covers the
// 7 days Sat..Fri that just ended), and can be invoked manually by an admin
// ("Generate now") to refresh the current week without re-sending email.
//
// Aggregates from base tables (platform_daily_metrics, audience_snapshots,
// revenue_events, analytics_youtube_daily, content_items/content_metrics) and
// tracking_post_goals; computes week-over-week + trailing-4-week-average
// deltas; asks Claude for wins / watch-outs / recommendations; upserts a
// weekly_reports row; and (cron path only, first generation) fires admin bell
// notifications + emails the report.
//
// Auth: CRON_SECRET (?secret= or X-Cron-Secret header) for the cron path, or an
// admin JWT for the manual path.
// Body (optional): { week_start: "YYYY-MM-DD", send: boolean }
// Deploy: supabase functions deploy generate-weekly-report --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resendSend } from "../shared/resend.ts";

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

// ── date helpers (UTC) ───────────────────────────────────────
function ymd(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}
function inRange(dateStr: string, start: string, end: string): boolean {
  return dateStr >= start && dateStr <= end;
}
function pctChange(cur: number, base: number): number | null {
  if (base === 0) return cur === 0 ? 0 : null; // null = "new / n/a"
  return Math.round(((cur - base) / Math.abs(base)) * 1000) / 10;
}
function delta(cur: number, last: number, avg4: number) {
  return { value: cur, wow: pctChange(cur, last), vs4wk: pctChange(cur, avg4) };
}

// ── Claude narrative ─────────────────────────────────────────
async function aiNarrative(summary: unknown): Promise<Record<string, unknown>> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return {};
  const prompt = `You are the analytics lead for a multi-platform content/creator business. Below is this week's KPI summary as JSON, with week-over-week (wow) and vs-trailing-4-week-average (vs4wk) percent deltas.

${JSON.stringify(summary, null, 2)}

Write a concise weekly readout. Be specific and quantitative (cite the actual numbers/deltas). No fluff.

Respond with ONLY a JSON object:
{"headline":"one punchy sentence on the week","wins":["..."],"watch_outs":["..."],"recommendations":["concrete next step", "..."]}
3-4 items max per list. If data is sparse, say so honestly rather than inventing.`;

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
        max_tokens: 1200,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) {
      console.error("Claude error", res.status, await res.text());
      return {};
    }
    const j = await res.json();
    const text = j?.content?.[0]?.text || "";
    const m = text.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : {};
  } catch (e) {
    console.error("aiNarrative failed", e);
    return {};
  }
}

// ── email ────────────────────────────────────────────────────
function fmtDelta(d: { wow: number | null; vs4wk: number | null }): string {
  const s = (v: number | null) => (v === null ? "n/a" : `${v >= 0 ? "+" : ""}${v}%`);
  return `WoW ${s(d.wow)} · 4wk ${s(d.vs4wk)}`;
}
function usd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function buildEmailHtml(report: {
  week_start: string; week_end: string;
  data: Record<string, unknown>;
  narrative: Record<string, unknown>;
}): string {
  const d = report.data as Record<string, unknown>;
  const n = report.narrative as Record<string, unknown>;
  const totals = (d.totals || {}) as Record<string, { value: number; wow: number | null; vs4wk: number | null }>;
  const list = (arr: unknown, color: string) =>
    Array.isArray(arr) && arr.length
      ? `<ul style="margin:8px 0 16px;padding-left:18px;color:#cbd5e1;font-size:14px;line-height:1.6">${arr
          .map((x) => `<li style="margin-bottom:4px"><span style="color:${color}">●</span> ${String(x)}</li>`)
          .join("")}</ul>`
      : "";
  const kpiRow = (label: string, key: string, fmt: (v: number) => string) => {
    const k = totals[key];
    if (!k) return "";
    return `<tr>
      <td style="padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.08);color:#e2e8f0;font-size:14px">${label}</td>
      <td style="padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.08);color:#fff;font-size:15px;font-weight:600;text-align:right">${fmt(k.value)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.08);color:#94a3b8;font-size:12px;text-align:right">${fmtDelta(k)}</td>
    </tr>`;
  };

  return `<!doctype html><html><body style="margin:0;background:#0f0f1a;font-family:'DM Sans',Helvetica,Arial,sans-serif">
  <div style="max-width:640px;margin:0 auto;padding:24px">
    <div style="background:linear-gradient(135deg,#6366f1,#818cf8);border-radius:12px;padding:20px 24px;margin-bottom:20px">
      <div style="color:#fff;font-size:20px;font-weight:700">Weekly KPI Report</div>
      <div style="color:rgba(255,255,255,0.85);font-size:13px;margin-top:2px">${report.week_start} → ${report.week_end}</div>
    </div>
    ${n.headline ? `<div style="color:#e2e8f0;font-size:16px;font-weight:600;margin-bottom:16px;line-height:1.4">${String(n.headline)}</div>` : ""}
    <table style="width:100%;border-collapse:collapse;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:10px;overflow:hidden;margin-bottom:20px">
      ${kpiRow("Views", "views", (v) => v.toLocaleString())}
      ${kpiRow("Followers gained", "followers_gained", (v) => (v >= 0 ? "+" : "") + v.toLocaleString())}
      ${kpiRow("Engagement", "engagement", (v) => v.toLocaleString())}
      ${kpiRow("Revenue", "revenue_cents", usd)}
    </table>
    ${n.wins ? `<div style="color:#86efac;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.5px">Wins</div>${list(n.wins, "#22c55e")}` : ""}
    ${n.watch_outs ? `<div style="color:#fcd34d;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.5px">Watch-outs</div>${list(n.watch_outs, "#f59e0b")}` : ""}
    ${n.recommendations ? `<div style="color:#a5b4fc;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.5px">Recommendations</div>${list(n.recommendations, "#6366f1")}` : ""}
    <div style="color:#64748b;font-size:12px;margin-top:20px">Open the Analytics tab for the full breakdown — per-platform growth, top content, revenue and cadence.</div>
  </div></body></html>`;
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

  let isCron = !!cronSecret &&
    (querySecret === cronSecret || headerSecret === cronSecret || auth === `Bearer ${cronSecret}`);
  let isAdmin = false;

  const db = admin();

  if (!isCron && auth?.startsWith("Bearer ")) {
    const { data: { user } } = await db.auth.getUser(auth.replace("Bearer ", ""));
    if (user) {
      const { data: profile } = await db.from("profiles").select("role").eq("id", user.id).single();
      if (profile?.role === "admin") isAdmin = true;
    }
  }
  if (!isCron && !isAdmin) return jsonResp({ error: "Unauthorized" }, 401);

  let body: { week_start?: string; send?: boolean } = {};
  try { body = await req.json(); } catch { /* empty body ok */ }

  try {
    // ── window math ──
    let weekStart: Date, weekEnd: Date;
    if (body.week_start) {
      weekStart = new Date(body.week_start + "T00:00:00Z");
      weekEnd = addDays(weekStart, 6);
    } else {
      weekEnd = addDays(new Date(), -1);   // yesterday (Fri when run Sat)
      weekStart = addDays(weekEnd, -6);
    }
    const wkStart = ymd(weekStart), wkEnd = ymd(weekEnd);
    const prevStart = ymd(addDays(weekStart, -7)), prevEnd = ymd(addDays(weekStart, -1));
    const baseStart = ymd(addDays(weekStart, -28)), baseEnd = ymd(addDays(weekStart, -1));

    // ── reference data ──
    const { data: accounts } = await db
      .from("platform_accounts")
      .select("id, platform, account_name, is_active");
    const acctMap = new Map((accounts || []).map((a) => [a.id, a]));
    const platformOf = (id: string) => acctMap.get(id)?.platform || "unknown";

    // ── platform_daily_metrics (views/engagement) over the full 5-week span ──
    const { data: pdm } = await db
      .from("platform_daily_metrics")
      .select("platform_account_id, date, views, likes, comments, shares")
      .gte("date", baseStart)
      .lte("date", wkEnd);

    const engOf = (r: { likes?: number; comments?: number; shares?: number }) =>
      (r.likes || 0) + (r.comments || 0) + (r.shares || 0);

    function sumMetrics(start: string, end: string) {
      let views = 0, engagement = 0;
      const byPlatform: Record<string, { views: number; engagement: number }> = {};
      for (const r of pdm || []) {
        if (!inRange(r.date, start, end)) continue;
        const p = platformOf(r.platform_account_id);
        views += r.views || 0;
        engagement += engOf(r);
        byPlatform[p] = byPlatform[p] || { views: 0, engagement: 0 };
        byPlatform[p].views += r.views || 0;
        byPlatform[p].engagement += engOf(r);
      }
      return { views, engagement, byPlatform };
    }
    const wk = sumMetrics(wkStart, wkEnd);
    const prev = sumMetrics(prevStart, prevEnd);
    const base = sumMetrics(baseStart, baseEnd);

    // ── audience_snapshots (followers) ──
    const { data: aud } = await db
      .from("audience_snapshots")
      .select("platform_account_id, date, followers_total, followers_gained")
      .gte("date", baseStart)
      .lte("date", wkEnd);

    function followersGained(start: string, end: string) {
      let total = 0;
      const byPlatform: Record<string, number> = {};
      for (const r of aud || []) {
        if (!inRange(r.date, start, end)) continue;
        const p = platformOf(r.platform_account_id);
        total += r.followers_gained || 0;
        byPlatform[p] = (byPlatform[p] || 0) + (r.followers_gained || 0);
      }
      return { total, byPlatform };
    }
    const wkF = followersGained(wkStart, wkEnd);
    const prevF = followersGained(prevStart, prevEnd);
    const baseF = followersGained(baseStart, baseEnd);

    // latest followers_total per platform (end of week)
    const followerTotals: Record<string, number> = {};
    {
      const latestByAcct = new Map<string, { date: string; total: number }>();
      for (const r of aud || []) {
        if (r.date > wkEnd) continue;
        const cur = latestByAcct.get(r.platform_account_id);
        if (!cur || r.date > cur.date) latestByAcct.set(r.platform_account_id, { date: r.date, total: r.followers_total || 0 });
      }
      for (const [id, v] of latestByAcct) {
        const p = platformOf(id);
        followerTotals[p] = (followerTotals[p] || 0) + v.total;
      }
    }

    // ── revenue_events ──
    const { data: rev } = await db
      .from("revenue_events")
      .select("platform_account_id, occurred_at, amount_cents, net_amount_cents, product_category, event_type")
      .gte("occurred_at", baseStart)
      .lte("occurred_at", wkEnd + "T23:59:59Z");

    function revenue(start: string, end: string) {
      let gross = 0, net = 0;
      const byPlatform: Record<string, { gross: number; net: number }> = {};
      for (const r of rev || []) {
        const day = (r.occurred_at || "").slice(0, 10);
        if (!inRange(day, start, end)) continue;
        const p = platformOf(r.platform_account_id);
        gross += r.amount_cents || 0;
        net += (r.net_amount_cents ?? r.amount_cents) || 0;
        byPlatform[p] = byPlatform[p] || { gross: 0, net: 0 };
        byPlatform[p].gross += r.amount_cents || 0;
        byPlatform[p].net += (r.net_amount_cents ?? r.amount_cents) || 0;
      }
      return { gross, net, byPlatform };
    }
    const wkR = revenue(wkStart, wkEnd);
    const prevR = revenue(prevStart, prevEnd);
    const baseR = revenue(baseStart, baseEnd);

    // ── YouTube ad revenue + RPM ──
    const { data: yt } = await db
      .from("analytics_youtube_daily")
      .select("date, estimated_revenue, ad_revenue, rpm, views")
      .gte("date", baseStart)
      .lte("date", wkEnd);
    function ytRevenue(start: string, end: string) {
      let estRev = 0, views = 0;
      for (const r of yt || []) {
        if (!inRange(r.date, start, end)) continue;
        estRev += Number(r.estimated_revenue || 0);
        views += Number(r.views || 0);
      }
      const rpm = views > 0 ? Math.round((estRev / views) * 1000 * 100) / 100 : 0;
      return { estRevCents: Math.round(estRev * 100), rpm };
    }
    const wkYt = ytRevenue(wkStart, wkEnd);
    const prevYt = ytRevenue(prevStart, prevEnd);
    const baseYt = ytRevenue(baseStart, baseEnd);

    // total revenue = revenue_events net + YouTube estimated
    const totRevWk = wkR.net + wkYt.estRevCents;
    const totRevPrev = prevR.net + prevYt.estRevCents;
    const totRevBase = baseR.net + baseYt.estRevCents;

    // ── content published this week (top/bottom + cadence) ──
    const { data: items } = await db
      .from("content_items")
      .select("id, title, url, platform_account_id, published_at")
      .gte("published_at", wkStart + "T00:00:00Z")
      .lte("published_at", wkEnd + "T23:59:59Z");
    const itemIds = (items || []).map((i) => i.id);
    let metricsByItem = new Map<string, { views: number; engagement: number; engagement_rate: number }>();
    if (itemIds.length) {
      const { data: cm } = await db
        .from("content_metrics")
        .select("content_item_id, captured_at, views, likes, comments, shares, engagement_rate")
        .in("content_item_id", itemIds);
      const latest = new Map<string, { captured_at: string }>();
      for (const r of cm || []) {
        const cur = latest.get(r.content_item_id);
        if (!cur || r.captured_at > cur.captured_at) {
          latest.set(r.content_item_id, { captured_at: r.captured_at });
          metricsByItem.set(r.content_item_id, {
            views: r.views || 0,
            engagement: (r.likes || 0) + (r.comments || 0) + (r.shares || 0),
            engagement_rate: Number(r.engagement_rate || 0),
          });
        }
      }
    }
    const contentRanked = (items || []).map((i) => {
      const m = metricsByItem.get(i.id) || { views: 0, engagement: 0, engagement_rate: 0 };
      return {
        title: i.title || "(untitled)",
        url: i.url,
        platform: platformOf(i.platform_account_id),
        published_at: i.published_at,
        views: m.views,
        engagement: m.engagement,
        engagement_rate: m.engagement_rate,
      };
    }).sort((a, b) => b.views - a.views);
    const topContent = contentRanked.slice(0, 5);
    const bottomContent = contentRanked.length > 5 ? contentRanked.slice(-3).reverse() : [];

    // ── cadence vs goals ──
    const publishedByPlatform: Record<string, number> = {};
    for (const i of items || []) {
      const p = platformOf(i.platform_account_id);
      publishedByPlatform[p] = (publishedByPlatform[p] || 0) + 1;
    }
    const monthOfEnd = weekEnd.getUTCMonth() + 1;
    const yearOfEnd = weekEnd.getUTCFullYear();
    const daysInMonth = new Date(Date.UTC(yearOfEnd, monthOfEnd, 0)).getUTCDate();
    const { data: goals } = await db
      .from("tracking_post_goals")
      .select("column_key, goal, year, month")
      .eq("year", yearOfEnd)
      .eq("month", monthOfEnd);
    const cadence = (goals || []).map((g) => {
      const weeklyTarget = Math.round(((g.goal || 0) * 7) / daysInMonth);
      const key = String(g.column_key || "").toLowerCase();
      // match goal column_key to a platform bucket loosely
      const published = Object.entries(publishedByPlatform)
        .filter(([p]) => key.includes(p) || p.includes(key))
        .reduce((s, [, c]) => s + c, 0);
      return { source: g.column_key, weekly_target: weeklyTarget, published, met: published >= weeklyTarget };
    });

    // ── assemble ──
    const data = {
      window: { week_start: wkStart, week_end: wkEnd, prev_start: prevStart, prev_end: prevEnd },
      totals: {
        views: delta(wk.views, prev.views, base.views / 4),
        followers_gained: delta(wkF.total, prevF.total, baseF.total / 4),
        engagement: delta(wk.engagement, prev.engagement, base.engagement / 4),
        revenue_cents: delta(totRevWk, totRevPrev, totRevBase / 4),
      },
      audience: {
        gained_by_platform: wkF.byPlatform,
        follower_totals: followerTotals,
      },
      reach: {
        views_by_platform: wk.byPlatform,
      },
      revenue: {
        net_cents: wkR.net,
        gross_cents: wkR.gross,
        margin_pct: wkR.gross > 0 ? Math.round((wkR.net / wkR.gross) * 1000) / 10 : null,
        by_platform: wkR.byPlatform,
        youtube_est_cents: wkYt.estRevCents,
        youtube_rpm: wkYt.rpm,
        total_cents: totRevWk,
        total_wow: pctChange(totRevWk, totRevPrev),
        total_vs4wk: pctChange(totRevWk, totRevBase / 4),
      },
      content: { top: topContent, bottom: bottomContent },
      cadence,
    };

    // compact summary for the model (no nested deltas noise beyond totals)
    const summary = {
      window: data.window,
      totals: data.totals,
      audience: data.audience,
      revenue: { ...data.revenue, by_platform: data.revenue.by_platform },
      top_content: topContent.map((c) => ({ title: c.title, platform: c.platform, views: c.views })),
      cadence,
    };
    const narrative = await aiNarrative(summary);

    // ── upsert (detect first generation for this week) ──
    const { data: existing } = await db
      .from("weekly_reports").select("id").eq("week_start", wkStart).maybeSingle();
    const isFirst = !existing;

    const { data: saved, error: upErr } = await db
      .from("weekly_reports")
      .upsert({ week_start: wkStart, week_end: wkEnd, data, narrative, generated_at: new Date().toISOString() },
        { onConflict: "week_start" })
      .select("id")
      .single();
    if (upErr) throw upErr;

    // ── notify + email: only on the cron path's first generation, or send:true ──
    let notified = 0, emailed = 0;
    const shouldSend = (isCron && isFirst) || body.send === true;
    if (shouldSend) {
      const { data: admins } = await db
        .from("profiles").select("id, email").eq("role", "admin");

      // bell notifications for all admins
      const notes = (admins || []).filter((a) => a.id).map((a) => ({
        user_id: a.id,
        type: "weekly_report",
        title: "Weekly KPI report ready",
        body: String(narrative.headline || `${wkStart} → ${wkEnd}`),
        link_tab: "analytics",
        link_target: "weekly",
      }));
      if (notes.length) {
        const { error } = await db.from("notifications").insert(notes);
        if (!error) notified = notes.length;
      }

      // email recipients: WEEKLY_REPORT_EMAILS env, else the first admin (owner)
      const envEmails = (Deno.env.get("WEEKLY_REPORT_EMAILS") || "")
        .split(",").map((s) => s.trim()).filter(Boolean);
      let recipients = envEmails;
      if (recipients.length === 0) {
        const { data: firstAdmin } = await db
          .from("profiles").select("email").eq("role", "admin").not("email", "is", null)
          .order("created_at", { ascending: true }).limit(1).maybeSingle();
        if (firstAdmin?.email) recipients = [firstAdmin.email];
      }
      const from = Deno.env.get("RESEND_FROM_EMAIL");
      if (from && recipients.length) {
        const html = buildEmailHtml({ week_start: wkStart, week_end: wkEnd, data, narrative });
        const subject = `Weekly KPI Report — ${wkStart} → ${wkEnd}`;
        for (const to of recipients) {
          try { await resendSend({ from, to, subject, html }); emailed++; }
          catch (e) { console.error("email failed", to, e); }
        }
      }
    }

    return jsonResp({
      ok: true, id: saved?.id, week_start: wkStart, week_end: wkEnd,
      first_generation: isFirst, notified, emailed,
    });
  } catch (err) {
    console.error("generate-weekly-report error:", err);
    return jsonResp({ error: String(err instanceof Error ? err.message : err) }, 500);
  }
});
