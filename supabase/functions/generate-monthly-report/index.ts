// supabase/functions/generate-monthly-report/index.ts
// Builds the monthly accounting report. Runs on the 3rd of each month via
// pg_cron (covering the prior calendar month, so late-posting Tiller
// transactions have settled), and can be invoked manually by an admin
// ("Generate now") to refresh any month.
//
// Produces THREE reports per month — scopes 'combined', 'mayday_media', and
// 'neptune_performance' — each with its own P&L (totals + per-category with
// month-over-month, trailing-3-month-average, and year-over-year deltas, plus
// YTD running totals), sponsor pipeline (Mayday + combined only), a
// vendor-level subscriptions audit, and a Claude-written financial narrative.
// Upserts one monthly_reports row per scope; fires admin bell notifications
// on the cron path's first generation (no email — bell only by design).
//
// Auth: CRON_SECRET (?secret= or X-Cron-Secret header) for the cron path, or
// an admin JWT for the manual path.
// Body (optional): { month_start: "YYYY-MM-01", send: boolean }
// Deploy: supabase functions deploy generate-monthly-report --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL = Deno.env.get("CLAUDE_MODEL") || "claude-sonnet-4-6";

const SCOPES = ["combined", "mayday_media", "neptune_performance"] as const;
type Scope = (typeof SCOPES)[number];

const SCOPE_LABELS: Record<Scope, string> = {
  combined: "Mayday Media + Neptune Performance (combined)",
  mayday_media: "Mayday Media",
  neptune_performance: "Neptune Performance",
};

// Mayday's subscription expense categories (fixed taxonomy). Neptune's
// categories come from its own sheet, so subscription-ish ones are matched
// by name instead.
const MAYDAY_SUB_CATEGORIES = new Set(["Admin Subscriptions", "Creative Subscriptions"]);
const isSubCategory = (business: string, category: string) =>
  business === "mayday_media"
    ? MAYDAY_SUB_CATEGORIES.has(category)
    : /subscri/i.test(category || "");

// Sponsor pipeline constants — mirror computeSponsorPipeline in
// src/pages/Accounting.js.
const AGENCY_FEE = 0.20;
const OUTSTANDING_DAYS = 45;

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

// ── month helpers ('YYYY-MM' strings, UTC) ───────────────────
function addMonthsYM(ymStr: string, n: number): string {
  const [y, m] = ymStr.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function monthStartOf(ymStr: string): string { return `${ymStr}-01`; }
function monthEndOf(ymStr: string): string {
  const [y, m] = ymStr.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${ymStr}-${String(last).padStart(2, "0")}`;
}
function monthLabel(ymStr: string): string {
  const [y, m] = ymStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: "long", year: "numeric", timeZone: "UTC",
  });
}
function pctChange(cur: number, base: number): number | null {
  if (base === 0) return cur === 0 ? 0 : null; // null = "new / n/a"
  return Math.round(((cur - base) / Math.abs(base)) * 1000) / 10;
}

// ── vendor normalization for the subscriptions audit ─────────
// Bank descriptions are noisy ("ADOBE *CC 800-833-6687" vs "ADOBE SYSTEMS").
// Uppercase, strip digit runs and punctuation, drop banking boilerplate,
// keep the first three tokens. Occasional split vendors are the tradeoff.
const VENDOR_NOISE = new Set([
  "POS", "DEBIT", "CREDIT", "PURCHASE", "PAYMENT", "RECURRING", "WEB",
  "ACH", "PPD", "CCD", "INC", "LLC", "CORP", "COM", "WWW", "HTTPS", "PAYPAL",
]);
function vendorKey(desc: string): string {
  const tokens = (desc || "")
    .toUpperCase()
    .replace(/\d+/g, " ")
    .replace(/[^A-Z& ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !VENDOR_NOISE.has(t));
  return tokens.slice(0, 3).join(" ") || "UNKNOWN";
}

// ── Claude narrative (with retry) ────────────────────────────
async function aiNarrative(scope: Scope, summary: unknown): Promise<Record<string, unknown>> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return { _error: "ANTHROPIC_API_KEY not configured" };
  const prompt = `You are the finance lead for a content/creator business. Below is the monthly P&L summary for ${SCOPE_LABELS[scope]} as JSON. All money values are in cents. Deltas: "mom" = vs prior month, "vs3mo" = vs trailing-3-month average, "yoy" = vs same month last year (null means no baseline yet).

${JSON.stringify(summary, null, 2)}

Write a concise monthly financial readout. Be specific and quantitative (cite the actual dollar amounts and deltas — convert cents to dollars). Cover: revenue and expense swings by category, net margin, sponsor pipeline health (late payments are a red flag), and subscription creep (new vendors, price increases). No fluff.

Respond with ONLY a JSON object:
{"headline":"one punchy sentence on the month","wins":["..."],"watch_outs":["..."],"recommendations":["concrete next step", "..."]}
3-4 items max per list. If data is sparse, say so honestly rather than inventing.`;

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
          max_tokens: 1200,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        console.error(`Claude error (${scope}, attempt ${attempt})`, res.status, errText);
        if (attempt === 0) { await new Promise((r) => setTimeout(r, 3000)); continue; }
        return { _error: `Claude API ${res.status}` };
      }
      const j = await res.json();
      const text = j?.content?.[0]?.text || "";
      const m = text.match(/\{[\s\S]*\}/);
      return m ? JSON.parse(m[0]) : {};
    } catch (e) {
      console.error(`aiNarrative failed (${scope}, attempt ${attempt})`, e);
      if (attempt === 0) { await new Promise((r) => setTimeout(r, 3000)); continue; }
      return { _error: String(e instanceof Error ? e.message : e) };
    }
  }
  return { _error: "Exhausted retries" };
}

// ── paginated fetch (Tiller syncs every bank line — ranges exceed 1000) ──
type Txn = {
  date: string; description: string | null; category: string;
  amount_cents: number; business: string;
};
async function fetchAllTxns(db: SupabaseClient, table: string, start: string, end: string): Promise<Txn[]> {
  const PAGE = 1000;
  const all: Txn[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from(table)
      .select("date, description, category, amount_cents, business")
      .eq("is_transfer", false)
      .eq("is_duplicate", false)
      .gte("date", start)
      .lte("date", end)
      .order("date", { ascending: true })
      .order("transaction_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data) {
      all.push({ ...r, business: r.business || "mayday_media" } as Txn);
    }
    if (data.length < PAGE) break;
  }
  return all;
}

// ── per-month aggregates for one scope ───────────────────────
type MonthAgg = { total: number; byCat: Record<string, number> };
function aggregateByMonth(txns: Txn[]): Map<string, MonthAgg> {
  const map = new Map<string, MonthAgg>();
  for (const t of txns) {
    const key = t.date.slice(0, 7);
    let agg = map.get(key);
    if (!agg) { agg = { total: 0, byCat: {} }; map.set(key, agg); }
    agg.total += t.amount_cents || 0;
    agg.byCat[t.category] = (agg.byCat[t.category] || 0) + (t.amount_cents || 0);
  }
  return map;
}
const emptyAgg: MonthAgg = { total: 0, byCat: {} };
function aggOf(map: Map<string, MonthAgg>, ymStr: string): MonthAgg {
  return map.get(ymStr) || emptyAgg;
}
function avg3(map: Map<string, MonthAgg>, targetYM: string): MonthAgg {
  const months = [-3, -2, -1].map((n) => aggOf(map, addMonthsYM(targetYM, n)));
  const byCat: Record<string, number> = {};
  for (const m of months) {
    for (const [c, v] of Object.entries(m.byCat)) byCat[c] = (byCat[c] || 0) + v;
  }
  for (const c of Object.keys(byCat)) byCat[c] = byCat[c] / 3;
  return { total: months.reduce((s, m) => s + m.total, 0) / 3, byCat };
}
function ytdTotal(map: Map<string, MonthAgg>, targetYM: string): number {
  const year = targetYM.slice(0, 4);
  let total = 0;
  for (const [k, v] of map) {
    if (k.slice(0, 4) === year && k <= targetYM) total += v.total;
  }
  return total;
}

function categoryRows(cur: MonthAgg, prev: MonthAgg, base3: MonthAgg, yoy: MonthAgg) {
  const cats = new Set([...Object.keys(cur.byCat), ...Object.keys(prev.byCat)]);
  return [...cats]
    .map((category) => ({
      category,
      value: Math.round(cur.byCat[category] || 0),
      mom: pctChange(cur.byCat[category] || 0, prev.byCat[category] || 0),
      vs3mo: pctChange(cur.byCat[category] || 0, base3.byCat[category] || 0),
      yoy: pctChange(cur.byCat[category] || 0, yoy.byCat[category] || 0),
    }))
    .filter((r) => r.value !== 0 || (prev.byCat[r.category] || 0) !== 0)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
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
      if (profile?.role === "admin") isAdmin = true;
    }
  }
  if (!isCron && !isAdmin) return jsonResp({ error: "Unauthorized" }, 401);

  let body: { month_start?: string; send?: boolean } = {};
  try { body = await req.json(); } catch { /* empty body ok */ }

  try {
    // ── window math ──
    // Target month: explicit month_start, else the month before today.
    const now = new Date();
    const currentYM = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const targetYM = body.month_start
      ? body.month_start.slice(0, 7)
      : addMonthsYM(currentYM, -1);
    const monthStart = monthStartOf(targetYM);
    const monthEnd = monthEndOf(targetYM);
    const prevYM = addMonthsYM(targetYM, -1);
    const yoyYM = addMonthsYM(targetYM, -12);

    // Fetch 13 months of transactions — covers the target month, MoM,
    // trailing-3, YoY, and YTD baselines in one pass per table.
    const fetchStart = monthStartOf(yoyYM);
    const [revTxns, expTxns] = await Promise.all([
      fetchAllTxns(db, "revenue_transactions", fetchStart, monthEnd),
      fetchAllTxns(db, "expense_transactions", fetchStart, monthEnd),
    ]);

    // ── sponsor pipeline (current snapshot — mirrors Accounting.js) ──
    const [{ data: campaigns }, { data: deliverables }] = await Promise.all([
      db.from("sponsor_campaigns").select("id, payment_status, apply_agency_fee, fully_delivered_at"),
      db.from("sponsor_deliverables").select("campaign_id, pay"),
    ]);
    const grossByCampaign = new Map<string, number>();
    for (const d of deliverables || []) {
      const cents = Math.round((parseFloat(d.pay) || 0) * 100);
      grossByCampaign.set(d.campaign_id, (grossByCampaign.get(d.campaign_id) || 0) + cents);
    }
    let expected = 0, outstanding = 0, late = 0;
    for (const c of campaigns || []) {
      if (c.payment_status === "paid") continue;
      const gross = grossByCampaign.get(c.id) || 0;
      const net = c.apply_agency_fee === false ? gross : Math.round(gross * (1 - AGENCY_FEE));
      if (c.fully_delivered_at) {
        const days = (Date.now() - new Date(c.fully_delivered_at).getTime()) / 86400000;
        if (days > OUTSTANDING_DAYS) late += net;
        else outstanding += net;
      } else {
        expected += net;
      }
    }
    const pipelineSnapshot = {
      expected, outstanding, late,
      incoming: expected + outstanding + late,
      as_of: new Date().toISOString().slice(0, 10),
    };

    // ── build the three scoped reports ──
    const results: Array<{ scope: Scope; data: Record<string, unknown>; narrative: Record<string, unknown> }> = [];
    const summaries: unknown[] = []; // parallel to results — model input per scope

    for (const scope of SCOPES) {
      const inScope = (t: Txn) => scope === "combined" || t.business === scope;
      const rev = revTxns.filter(inScope);
      const exp = expTxns.filter(inScope);

      const revByMonth = aggregateByMonth(rev);
      const expByMonth = aggregateByMonth(exp);

      const revCur = aggOf(revByMonth, targetYM), revPrev = aggOf(revByMonth, prevYM);
      const revBase3 = avg3(revByMonth, targetYM), revYoy = aggOf(revByMonth, yoyYM);
      const expCur = aggOf(expByMonth, targetYM), expPrev = aggOf(expByMonth, prevYM);
      const expBase3 = avg3(expByMonth, targetYM), expYoy = aggOf(expByMonth, yoyYM);

      const netCur = revCur.total - expCur.total;
      const netPrev = revPrev.total - expPrev.total;
      const netBase3 = revBase3.total - expBase3.total;
      const netYoy = revYoy.total - expYoy.total;
      const ytdRev = ytdTotal(revByMonth, targetYM);
      const ytdExp = ytdTotal(expByMonth, targetYM);

      // ── subscriptions audit (vendor level) ──
      const subTxnsIn = (txns: Txn[], ymStr: string) =>
        txns.filter((t) => t.date.slice(0, 7) === ymStr && isSubCategory(t.business, t.category));
      const vendorTotals = (txns: Txn[]) => {
        const m = new Map<string, { total: number; category: string }>();
        for (const t of txns) {
          const k = vendorKey(t.description || "");
          const cur = m.get(k) || { total: 0, category: t.category };
          cur.total += t.amount_cents || 0;
          m.set(k, cur);
        }
        return m;
      };
      const subsCur = vendorTotals(subTxnsIn(exp, targetYM));
      const subsPrev = vendorTotals(subTxnsIn(exp, prevYM));
      // "New" = not seen in the prior 3 months (a vendor skipping one month
      // and returning isn't new).
      const seenRecently = new Set<string>();
      for (const n of [-3, -2, -1]) {
        for (const k of vendorTotals(subTxnsIn(exp, addMonthsYM(targetYM, n))).keys()) seenRecently.add(k);
      }
      const vendors = [...subsCur.entries()]
        .map(([vendor, v]) => {
          const prevTotal = subsPrev.get(vendor)?.total ?? null;
          let status: string;
          if (!seenRecently.has(vendor)) status = "new";
          else if (prevTotal === null) status = "returned";
          else if (v.total > prevTotal + 100 && v.total > prevTotal * 1.05) status = "increased";
          else if (v.total < prevTotal - 100 && v.total < prevTotal * 0.95) status = "decreased";
          else status = "unchanged";
          return { vendor, total: v.total, prev_total: prevTotal, category: v.category, status };
        })
        .sort((a, b) => b.total - a.total);
      const gone = [...subsPrev.entries()]
        .filter(([vendor]) => !subsCur.has(vendor))
        .map(([vendor, v]) => ({ vendor, prev_total: v.total }))
        .sort((a, b) => b.prev_total - a.prev_total);
      const subsTotal = vendors.reduce((s, v) => s + v.total, 0);
      const subsPrevTotal = [...subsPrev.values()].reduce((s, v) => s + v.total, 0);

      // Sponsor pipeline is Mayday-only (that's where campaigns live).
      const includePipeline = scope !== "neptune_performance";
      const sponsorshipBooked = Math.round(revCur.byCat["Sponsorship Income"] || 0);

      const data: Record<string, unknown> = {
        window: { month_start: monthStart, month_end: monthEnd, label: monthLabel(targetYM) },
        scope,
        totals: {
          revenue: { value: Math.round(revCur.total), mom: pctChange(revCur.total, revPrev.total), vs3mo: pctChange(revCur.total, revBase3.total), yoy: pctChange(revCur.total, revYoy.total) },
          expenses: { value: Math.round(expCur.total), mom: pctChange(expCur.total, expPrev.total), vs3mo: pctChange(expCur.total, expBase3.total), yoy: pctChange(expCur.total, expYoy.total) },
          net: { value: Math.round(netCur), mom: pctChange(netCur, netPrev), vs3mo: pctChange(netCur, netBase3), yoy: pctChange(netCur, netYoy) },
          margin_pct: revCur.total > 0 ? Math.round((netCur / revCur.total) * 1000) / 10 : null,
        },
        ytd: { year: Number(targetYM.slice(0, 4)), revenue: Math.round(ytdRev), expenses: Math.round(ytdExp), net: Math.round(ytdRev - ytdExp) },
        revenue_by_category: categoryRows(revCur, revPrev, revBase3, revYoy),
        expenses_by_category: categoryRows(expCur, expPrev, expBase3, expYoy),
        sponsor_pipeline: includePipeline ? { ...pipelineSnapshot, booked_cents: sponsorshipBooked } : null,
        subscriptions: {
          total: subsTotal,
          prev_total: subsPrevTotal,
          mom: pctChange(subsTotal, subsPrevTotal),
          vendors,
          gone,
        },
        txn_count: rev.filter((t) => t.date.slice(0, 7) === targetYM).length +
          exp.filter((t) => t.date.slice(0, 7) === targetYM).length,
      };

      // Compact summary for the model — cap category lists to keep the
      // prompt lean; the full lists stay in `data` for the UI.
      const summary = {
        window: data.window,
        totals: data.totals,
        ytd: data.ytd,
        top_revenue_categories: (data.revenue_by_category as unknown[]).slice(0, 10),
        top_expense_categories: (data.expenses_by_category as unknown[]).slice(0, 12),
        sponsor_pipeline: data.sponsor_pipeline,
        subscriptions: {
          total: subsTotal,
          mom: pctChange(subsTotal, subsPrevTotal),
          new: vendors.filter((v) => v.status === "new"),
          increased: vendors.filter((v) => v.status === "increased"),
          gone,
        },
        transaction_count: data.txn_count,
      };
      results.push({ scope, data, narrative: {} });
      summaries.push(summary);
    }

    // ── narratives (three concurrent Claude calls) ──
    const narratives = await Promise.all(
      results.map((r, i) => aiNarrative(r.scope, summaries[i])),
    );
    results.forEach((r, i) => {
      r.narrative = narratives[i];
      if (r.narrative._error) {
        r.data.narrative_failed = true;
        console.warn(`Narrative failed (${r.scope}):`, r.narrative._error);
      }
    });

    // ── upsert (detect first generation for this month) ──
    const { data: existing } = await db
      .from("monthly_reports").select("id").eq("month_start", monthStart).eq("scope", "combined").maybeSingle();
    const isFirst = !existing;

    const generatedAt = new Date().toISOString();
    const { error: upErr } = await db
      .from("monthly_reports")
      .upsert(
        results.map((r) => ({
          month_start: monthStart,
          month_end: monthEnd,
          scope: r.scope,
          data: r.data,
          narrative: r.narrative,
          generated_at: generatedAt,
        })),
        { onConflict: "month_start,scope" },
      );
    if (upErr) throw upErr;

    // ── notify: bell only, on the cron path's first generation or send:true ──
    let notified = 0;
    if ((isCron && isFirst) || body.send === true) {
      const combined = results.find((r) => r.scope === "combined");
      const { data: admins } = await db.from("profiles").select("id").eq("role", "admin");
      const notes = (admins || []).filter((a) => a.id).map((a) => ({
        user_id: a.id,
        type: "monthly_report",
        title: `Monthly accounting report ready — ${monthLabel(targetYM)}`,
        body: String(combined?.narrative?.headline || `${monthStart} → ${monthEnd}`),
        link_tab: "accounting",
        link_target: "reports",
      }));
      if (notes.length) {
        const { error } = await db.from("notifications").insert(notes);
        if (!error) notified = notes.length;
      }
    }

    return jsonResp({
      ok: true, month_start: monthStart, month_end: monthEnd,
      scopes: results.map((r) => r.scope), first_generation: isFirst, notified,
    });
  } catch (err) {
    console.error("generate-monthly-report error:", err);
    return jsonResp({ error: String(err instanceof Error ? err.message : err) }, 500);
  }
});
