// supabase/functions/sync-metricool/index.ts
// Deploy with: supabase functions deploy sync-metricool --no-verify-jwt
// Pulls daily account-level metrics from Metricool's timelines API for Instagram, Facebook, TikTok
// Writes to platform_daily_metrics and audience_snapshots

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const MC_BASE = "https://app.metricool.com/api";

// Instagram account valid metrics: email_contacts, get_directions_clicks, phone_call_clicks,
// text_message_clicks, clicks_total, delta_followers, Followers, Friends, impressions, reach,
// profile_views, postsCount, postsInteractions, website_clicks, views, accounts_engaged
//
// Facebook account valid metrics: likes, pageViews, pageImpressions, page_posts_impressions,
// page_actions_post_reactions_total, pageFollows, Follows, Unfollows, page_daily_follows_unique,
// page_daily_unfollows_unique, page_media_view, page_website_clicks_logged_in_unique, ctaClicks,
// page_total_actions, postsCount, postsInteractions
//
// TikTok account valid metrics: video_views, profile_views, followers_count,
// followers_delta_count, likes, comments, shares

// cumulative: true = values are running totals; compute day-over-day delta for PDM
const PLATFORM_METRICS = [
  {
    platform: "instagram",
    network: "instagram",
    pdm: [
      { subject: "account", metric: "views", field: "views", cumulative: false },
      { subject: "account", metric: "postsInteractions", field: "likes", cumulative: false },
    ],
    followers: { subject: "account", metric: "Followers", cumulative: true },
  },
  {
    platform: "facebook",
    network: "facebook",
    pdm: [
      { subject: "account", metric: "page_posts_impressions", field: "views", cumulative: false },
      { subject: "account", metric: "postsInteractions", field: "likes", cumulative: false },
    ],
    followers: { subject: "account", metric: "pageFollows", cumulative: true },
  },
  {
    platform: "tiktok",
    network: "tiktok",
    pdm: [
      { subject: "account", metric: "likes", field: "likes", cumulative: true },
      // TikTok views live under subject="video", metric="views" (daily values).
      // Verified live 2026-06-28: account/video_views AND account/profile_views both
      // return 0, but video/views returns real daily view counts (e.g. 1831, 5709).
      // The account-subject metric set does not surface usable views for TikTok.
      { subject: "video", metric: "views", field: "views", cumulative: false },
    ],
    followers: { subject: "account", metric: "followers_count", cumulative: true },
  },
  {
    platform: "twitter",
    network: "twitter",
    pdm: [],
    followers: { subject: "account", metric: "followers_count", cumulative: true },
  },
  {
    platform: "threads",
    network: "threads",
    pdm: [],
    followers: { subject: "account", metric: "followers_count", cumulative: true },
  },
];

interface TimelinePoint {
  dateTime: string;
  value: number | null;
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function fetchTimeline(
  token: string,
  userId: string,
  blogId: string,
  network: string,
  subject: string,
  metric: string,
  from: string,
  to: string,
): Promise<{
  points: { date: string; value: number }[];
  raw: unknown;
  error?: string;
}> {
  const params = new URLSearchParams({
    userId,
    blogId,
    network,
    subject,
    metric,
    from,
    to,
  });
  const url = `${MC_BASE}/v2/analytics/timelines?${params}`;
  const resp = await fetch(url, {
    method: "GET",
    headers: { "X-Mc-Auth": token },
  });

  if (!resp.ok) {
    const errText = await resp.text();
    return {
      points: [],
      raw: null,
      error: `${resp.status}: ${errText.substring(0, 1000)}`,
    };
  }

  const body = await resp.json();
  const points: { date: string; value: number }[] = [];
  const dataArr = body?.data || body || [];
  for (const bucket of Array.isArray(dataArr) ? dataArr : [dataArr]) {
    const values: TimelinePoint[] = bucket?.values || [];
    for (const pt of values) {
      if (pt.dateTime && pt.value != null) {
        const num = Number(pt.value);
        if (Number.isFinite(num)) points.push({ date: pt.dateTime.slice(0, 10), value: num });
      }
    }
  }
  return { points, raw: body };
}

/**
 * For cumulative metrics (running totals like total likes or total followers),
 * compute day-over-day deltas. Returns { date: delta } for each date except the first.
 * Optional metricName/platform params enable diagnostic logging for staleness detection.
 */
function computeDeltas(
  points: { date: string; value: number }[],
  metricName?: string,
  platform?: string,
): Record<string, number> {
  // Sort by date ascending
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const result: Record<string, number> = {};
  let zeroStreak = 0;
  for (let i = 1; i < sorted.length; i++) {
    const delta = sorted[i].value - sorted[i - 1].value;
    result[sorted[i].date] = Math.max(0, delta); // clamp to 0 if negative
    // Track consecutive zero deltas for diagnostic logging
    if (delta === 0 && sorted[i].value === sorted[i - 1].value) {
      zeroStreak++;
    } else {
      zeroStreak = 0;
    }
  }
  // Log when TikTok cumulative metrics show repeated identical values (API staleness)
  if (zeroStreak >= 3 && platform && metricName) {
    console.log(`[DIAG] ${platform}/${metricName}: ${zeroStreak} consecutive zero-deltas from repeated cumulative values (${sorted[sorted.length - 1]?.value}). Likely API staleness, not genuine zero activity.`);
  }
  return result;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth: CRON_SECRET (header or query) or admin JWT required
  {
    const _expected = Deno.env.get("CRON_SECRET");
    const _provided = req.headers.get("x-cron-secret")
      ?? new URL(req.url).searchParams.get("secret");
    const _isCron = !!_expected && _provided === _expected;
    if (!_isCron) {
      const _auth = req.headers.get("Authorization");
      if (!_auth?.startsWith("Bearer ")) return jsonResponse({ error: "Unauthorized" }, 401);
      const _adminClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const { data: { user: _u } } = await _adminClient.auth.getUser(_auth.slice(7));
      if (!_u) return jsonResponse({ error: "Unauthorized" }, 401);
      const { data: _profile } = await _adminClient
        .from("profiles").select("role").eq("id", _u.id).single();
      if (_profile?.role !== "admin") return jsonResponse({ error: "Forbidden" }, 403);
    }
  }

  const mcToken = Deno.env.get("METRICOOL_TOKEN");
  const mcUserId = Deno.env.get("METRICOOL_USER_ID");
  const mcBlogId = Deno.env.get("METRICOOL_BLOG_ID");
  if (!mcToken || !mcUserId || !mcBlogId) {
    return jsonResponse({ error: "Metricool credentials not configured" }, 500);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const url = new URL(req.url);
  const daysBack = parseInt(url.searchParams.get("days") || "7", 10);
  const debugMode = url.searchParams.get("debug") === "true";

  // Fetch one extra day for cumulative delta computation
  const now = new Date();
  const toDate = new Date(now);
  toDate.setUTCDate(toDate.getUTCDate() - 1);
  const fromDate = new Date(now);
  fromDate.setUTCDate(fromDate.getUTCDate() - daysBack - 1); // extra day for deltas
  const fromStr = fromDate.toISOString().slice(0, 19) + "Z";
  const toStr = toDate.toISOString().slice(0, 19) + "Z";

  const results: Record<string, unknown> = {};

  for (const cfg of PLATFORM_METRICS) {
    const { data: account } = await supabase
      .from("platform_accounts")
      .select("id")
      .eq("platform", cfg.platform)
      .eq("is_active", true)
      .maybeSingle();

    if (!account) {
      results[cfg.platform] = { skipped: true, reason: "no active account" };
      continue;
    }

    const { data: logEntry } = await supabase
      .from("ingestion_logs")
      .insert({
        platform_account_id: account.id,
        job_type: "metricool_sync",
        status: "running",
      })
      .select()
      .single();

    try {
      const debugInfo: Record<string, unknown> = {};
      const apiErrors: Record<string, string> = {};
      const dailyMetrics: Record<string, Record<string, number>> = {};

      for (const m of cfg.pdm) {
        const { points, raw, error } = await fetchTimeline(
          mcToken, mcUserId, mcBlogId,
          cfg.network, m.subject, m.metric,
          fromStr, toStr,
        );
        if (error) {
          apiErrors[`${m.subject}/${m.metric}`] = error;
          continue;
        }
        if (debugMode) debugInfo[`${m.subject}/${m.metric}`] = { pointCount: points.length, sample: points.slice(0, 3) };

        // For cumulative metrics, compute deltas; for non-cumulative, use raw values
        const dayValues: Record<string, number> = m.cumulative
          ? computeDeltas(points, m.metric, cfg.platform)
          : Object.fromEntries(points.map((p) => [p.date, p.value]));

        for (const [date, value] of Object.entries(dayValues)) {
          if (!dailyMetrics[date]) dailyMetrics[date] = {};
          dailyMetrics[date][m.field] = (dailyMetrics[date][m.field] || 0) + value;
        }
      }

      // Fetch followers timeline (always cumulative — stored as snapshot total)
      const followersByDate: Record<string, number> = {};
      if (cfg.followers) {
        const { points, raw, error } = await fetchTimeline(
          mcToken, mcUserId, mcBlogId,
          cfg.network, cfg.followers.subject, cfg.followers.metric,
          fromStr, toStr,
        );
        if (error) {
          apiErrors[`${cfg.followers.subject}/${cfg.followers.metric}`] = error;
        } else {
          if (debugMode) debugInfo[`${cfg.followers.subject}/${cfg.followers.metric}`] = { pointCount: points.length, sample: points.slice(0, 3) };
          for (const pt of points) {
            followersByDate[pt.date] = pt.value;
          }
        }
      }

      // Upsert platform_daily_metrics
      let totalPdm = 0;
      const pdmRows = Object.entries(dailyMetrics).map(([date, m]) => ({
        platform_account_id: account.id,
        date,
        views: m.views || 0,
        likes: m.likes || 0,
        comments: m.comments || 0,
        shares: m.shares || 0,
        metadata: { source: "metricool" },
      }));
      for (let i = 0; i < pdmRows.length; i += 100) {
        const batch = pdmRows.slice(i, i + 100);
        const { error, data } = await supabase
          .from("platform_daily_metrics")
          .upsert(batch, { onConflict: "platform_account_id,date" })
          .select("id");
        if (error) apiErrors["pdm_upsert"] = error.message;
        else totalPdm += data?.length || 0;
      }

      // Upsert audience_snapshots. Metricool's followers metric is a cumulative
      // running total, so the daily *gain* is the day-over-day change. This was
      // previously hardcoded to 0, which zeroed out IG/TikTok/FB audience
      // velocity everywhere downstream (decision row, weekly report, rollups)
      // even though followers_total was moving. We now derive the gain from the
      // total, anchoring the earliest in-window day to the last snapshot before
      // the window so it isn't stuck at 0. (The window already fetches one extra
      // day — see daysBack + 1 above — for exactly this purpose.) Gains may be
      // negative on net-loss days, which is correct.
      let totalAud = 0;
      const sortedFollowers = Object.entries(followersByDate)
        .filter(([_, v]) => v > 0)
        .sort(([a], [b]) => a.localeCompare(b));

      let prevTotal: number | null = null;
      if (sortedFollowers.length) {
        const { data: priorSnap } = await supabase
          .from("audience_snapshots")
          .select("followers_total")
          .eq("platform_account_id", account.id)
          .lt("date", sortedFollowers[0][0])
          .order("date", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (priorSnap) prevTotal = priorSnap.followers_total;
      }

      const audRows = sortedFollowers.map(([date, followers]) => {
        const gained = prevTotal == null ? 0 : followers - prevTotal;
        prevTotal = followers;
        return {
          platform_account_id: account.id,
          date,
          followers_total: followers,
          followers_gained: gained,
          demographics: {},
          metadata: { source: "metricool" },
        };
      });
      for (let i = 0; i < audRows.length; i += 100) {
        const batch = audRows.slice(i, i + 100);
        const { error, data } = await supabase
          .from("audience_snapshots")
          .upsert(batch, { onConflict: "platform_account_id,date" })
          .select("id");
        if (error) apiErrors["aud_upsert"] = error.message;
        else totalAud += data?.length || 0;
      }

      // Complete ingestion log
      if (logEntry?.id) {
        await supabase
          .from("ingestion_logs")
          .update({
            status: "success",
            records_processed: totalPdm + totalAud,
            records_created: totalPdm + totalAud,
            completed_at: new Date().toISOString(),
            metadata: {
              source: "metricool",
              platform: cfg.platform,
              pdm_count: totalPdm,
              aud_count: totalAud,
            },
          })
          .eq("id", logEntry.id);
      }

      // Update platform account health so Ops "Platform health" reflects the sync
      await supabase
        .from("platform_accounts")
        .update({
          last_synced_at: new Date().toISOString(),
          last_success_at: new Date().toISOString(),
          consecutive_failures: 0,
        })
        .eq("id", account.id);

      results[cfg.platform] = {
        pdm_upserted: totalPdm,
        aud_upserted: totalAud,
        dates: Object.keys(dailyMetrics).sort(),
        ...(Object.keys(apiErrors).length ? { api_errors: apiErrors } : {}),
        ...(debugMode ? { debug: debugInfo } : {}),
      };
    } catch (err) {
      if (logEntry?.id) {
        await supabase
          .from("ingestion_logs")
          .update({
            status: "failed",
            error_message: err.message,
            completed_at: new Date().toISOString(),
          })
          .eq("id", logEntry.id);
      }
      results[cfg.platform] = { error: err.message };
    }
  }

  // ── YouTube audience_snapshots from analytics_youtube_daily ──
  // YouTube subscriber data comes from CSV uploads, not Metricool.
  // Compute running follower totals from daily subscriber gains, anchored to the latest known total.
  try {
    const { data: ytAccounts } = await supabase
      .from("platform_accounts")
      .select("id, account_name")
      .eq("platform", "youtube")
      .eq("is_active", true);

    for (const yt of ytAccounts || []) {
      // Get latest audience_snapshot as anchor
      const { data: anchor } = await supabase
        .from("audience_snapshots")
        .select("followers_total, date")
        .eq("platform_account_id", yt.id)
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!anchor) continue;

      // Get recent youtube daily data up to and INCLUDING the anchor date.
      // The anchor day's own subscriber gain must be subtracted before assigning
      // totals to earlier days; excluding it shifted every backfilled day's
      // follower_total up by one day's gain (off-by-one).
      const { data: ytDaily } = await supabase
        .from("analytics_youtube_daily")
        .select("date, subscribers")
        .eq("platform_account_id", yt.id)
        .lte("date", anchor.date)
        .gte("date", fromStr.slice(0, 10))
        .order("date", { ascending: false });

      if (!ytDaily?.length) continue;

      // Compute running totals backwards from anchor
      let runningTotal = anchor.followers_total;
      const audRows: {
        platform_account_id: string;
        date: string;
        followers_total: number;
        followers_gained: number;
        demographics: Record<string, never>;
        metadata: { source: string };
      }[] = [];

      for (const row of ytDaily) {
        // The anchor date already has an authoritative snapshot; don't overwrite
        // it — just step the running total back past its own gain so the first
        // backfilled (earlier) day starts from anchor.total - anchor.gain.
        if (row.date === anchor.date) {
          runningTotal -= (row.subscribers || 0);
          continue;
        }
        audRows.push({
          platform_account_id: yt.id,
          date: row.date,
          followers_total: Math.max(runningTotal, 0),
          followers_gained: row.subscribers || 0,
          demographics: {},
          metadata: { source: "youtube_daily_backfill" },
        });
        runningTotal -= (row.subscribers || 0);
      }

      let ytAudUpserted = 0;
      for (let i = 0; i < audRows.length; i += 100) {
        const batch = audRows.slice(i, i + 100);
        const { error, data } = await supabase
          .from("audience_snapshots")
          .upsert(batch, { onConflict: "platform_account_id,date" })
          .select("id");
        if (error) {
          console.error(`YouTube aud_upsert error for ${yt.account_name}:`, error.message);
        } else {
          ytAudUpserted += data?.length || 0;
        }
      }

      results[`youtube_${yt.account_name}`] = { aud_upserted: ytAudUpserted };
    }
  } catch (e) {
    results._youtube_aud_error = e.message;
  }

  // Refresh the materialized view so donut charts pick up new data
  try {
    await supabase.rpc("refresh_daily_platform_rollups");
    results._rollups_refreshed = true;
  } catch (e) {
    results._rollups_refreshed = false;
    results._rollups_error = e.message;
  }

  return jsonResponse({ ok: true, results });
});
