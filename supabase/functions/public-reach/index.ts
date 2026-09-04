// Public, login-free reach feed for the marketing site (maydaymedia.io).
//
// This is the "live media kit" endpoint: aggregate audience and 30-day view
// counts that a sponsor can read without an account. Deployed --no-verify-jwt.
//
// Two rules govern what leaves this function:
//
//   1. WHITELIST, NEVER PASSTHROUGH. platform_accounts holds `credentials` and
//      `config` jsonb. Every field in the response is built by hand below —
//      there is no spread of a database row anywhere in this file. Adding a
//      field is a deliberate edit.
//
//   2. NEVER PUBLISH A NUMBER YOU CAN'T DEFEND. A source whose newest row is
//      older than FRESH_DAYS is dropped from every total and reported in
//      `excluded` instead. Substack has been stale since March 2026; without
//      this guard its 2,667 followers would silently pad the headline number
//      forever. A total that dips in a slow month is worth more than one a
//      buyer can disprove.
//
// Revenue, pay, and per-video rows are deliberately absent.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Aggregate audience figures are meant to be public, so any origin may read
// them. The marketing site fetches server-side, where CORS does not apply;
// this header only matters for browser-side callers.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const WINDOW_DAYS = 30;   // rolling view window
const FRESH_DAYS = 7;     // a source older than this is excluded, not counted
const SNAPSHOT_LOOKBACK = 21; // how far back to hunt for each account's latest snapshot

// Accounts that exist for bookkeeping but carry no audience to report.
const NON_AUDIENCE_PLATFORMS = new Set(['stripe', 'fourthwall']);

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: Date): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((b - a) / 86_400_000);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const today = new Date();
    const windowStart = isoDaysAgo(WINDOW_DAYS);
    const snapshotStart = isoDaysAgo(SNAPSHOT_LOOKBACK);
    const yearStart = new Date(today);
    yearStart.setUTCFullYear(yearStart.getUTCFullYear() - 1);

    const [accountsRes, metricsRes, snapsRes, publishedRes, sponsorsRes] = await Promise.all([
      // Only these four columns — `credentials` and `config` must never leave.
      supabase
        .from('platform_accounts')
        .select('id, platform, account_name, is_active')
        .eq('is_active', true),
      supabase
        .from('platform_daily_metrics')
        .select('platform_account_id, date, views')
        .gte('date', windowStart),
      supabase
        .from('audience_snapshots')
        .select('platform_account_id, date, followers_total')
        .gte('date', snapshotStart),
      supabase
        .from('content_items')
        .select('id', { count: 'exact', head: true })
        .gte('published_at', yearStart.toISOString()),
      supabase
        .from('sponsors')
        .select('id', { count: 'exact', head: true }),
    ]);

    for (const r of [accountsRes, metricsRes, snapsRes, publishedRes, sponsorsRes]) {
      if (r.error) throw r.error;
    }

    const accounts = (accountsRes.data ?? []).filter(
      (a) => !NON_AUDIENCE_PLATFORMS.has(a.platform),
    );

    // Roll metrics up per account, tracking the newest row so staleness is
    // measured from real data rather than from the sync job's own claims.
    const views = new Map<string, number>();
    const newestMetric = new Map<string, string>();
    for (const m of metricsRes.data ?? []) {
      const id = m.platform_account_id;
      views.set(id, (views.get(id) ?? 0) + Number(m.views ?? 0));
      const prev = newestMetric.get(id);
      if (!prev || m.date > prev) newestMetric.set(id, m.date);
    }

    // Latest snapshot per account.
    const followers = new Map<string, number>();
    const newestSnap = new Map<string, string>();
    for (const s of snapsRes.data ?? []) {
      const id = s.platform_account_id;
      const prev = newestSnap.get(id);
      if (!prev || s.date > prev) {
        newestSnap.set(id, s.date);
        followers.set(id, Number(s.followers_total ?? 0));
      }
    }

    const platforms: Array<Record<string, unknown>> = [];
    const excluded: Array<Record<string, unknown>> = [];

    for (const acct of accounts) {
      // An account is as fresh as its freshest signal — some platforms report
      // followers daily but views on a lag, and vice versa.
      const dates = [newestMetric.get(acct.id), newestSnap.get(acct.id)].filter(
        Boolean,
      ) as string[];

      if (dates.length === 0) {
        excluded.push({
          platform: acct.platform,
          account: acct.account_name,
          reason: 'no_data',
        });
        continue;
      }

      const asOf = dates.sort().at(-1)!;
      const stale = daysBetween(asOf, today);

      if (stale > FRESH_DAYS) {
        excluded.push({
          platform: acct.platform,
          account: acct.account_name,
          reason: 'stale',
          as_of: asOf,
          days_stale: stale,
        });
        continue;
      }

      platforms.push({
        platform: acct.platform,
        account: acct.account_name,
        audience: followers.get(acct.id) ?? null,
        views_30d: views.get(acct.id) ?? 0,
        as_of: asOf,
      });
    }

    platforms.sort((a, b) => Number(b.audience ?? 0) - Number(a.audience ?? 0));

    const audienceTotal = platforms.reduce((n, p) => n + Number(p.audience ?? 0), 0);
    const viewsTotal = platforms.reduce((n, p) => n + Number(p.views_30d ?? 0), 0);

    const body = {
      generated_at: new Date().toISOString(),
      window_days: WINDOW_DAYS,
      freshness_cutoff_days: FRESH_DAYS,
      totals: {
        audience: audienceTotal,
        views_30d: viewsTotal,
        // Only platforms actually carrying an audience are counted, so the
        // headline "N platforms" always matches the list rendered beside it.
        platforms: platforms.filter((p) => Number(p.audience ?? 0) > 0).length,
        published_12mo: publishedRes.count ?? 0,
        brand_partners: sponsorsRes.count ?? 0,
      },
      platforms,
      excluded,
    };

    return new Response(JSON.stringify(body), {
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        // Cache at the edge for an hour; the underlying syncs are daily.
        'Cache-Control': 'public, max-age=300, s-maxage=3600',
      },
    });
  } catch (err) {
    console.error('public-reach failed', err);
    return new Response(
      JSON.stringify({ error: 'Could not load reach figures right now.' }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }
});
