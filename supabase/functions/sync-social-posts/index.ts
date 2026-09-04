// sync-social-posts — persist Instagram / TikTok / Facebook posts into
// content_items + content_metrics, the way sync-youtube already does for
// YouTube.
//
// Until now the only per-post record of short-form was a live Metricool call
// on page load, which meant no history, no trends, and no performance data —
// just "did we hit 5 this week". The analytics endpoints carry views, reach,
// saves, watch time and skip rate per post; this stores them.
//
// Deploy: supabase functions deploy sync-social-posts --no-verify-jwt
// Auth: cron secret header, or an admin-tier JWT.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchAnalyticsPosts } from "../shared/metricoolAnalytics.ts";

const ADMIN_TIER = ["admin", "director"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Which platform_accounts row each network's posts belong to. Resolved by
// platform so a re-pointed account doesn't need a code change.
const NETWORK_PLATFORM: Record<string, string> = {
  INSTAGRAM: "instagram",
  TIKTOK: "tiktok",
  FACEBOOK: "facebook",
};

// content_items.content_type is an enum: video|short|post|reel|story|article|…
function contentTypeFor(network: string, subtype: string | null): string {
  if (subtype === "REEL") return "reel";
  if (network === "TIKTOK") return "short";
  return "post";
}

function ptDayString(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ── Auth: cron secret or admin-tier JWT ──
  const cronSecret = Deno.env.get("CRON_SECRET");
  const provided = req.headers.get("x-cron-secret")
    ?? new URL(req.url).searchParams.get("secret");
  let isCron = Boolean(cronSecret && provided === cronSecret);

  if (!isCron) {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const { data: { user } } = await admin.auth.getUser(authHeader.slice(7));
    if (!user) return json({ error: "Unauthorized" }, 401);
    const { data: profile } = await admin
      .from("profiles").select("role").eq("id", user.id).single();
    if (!ADMIN_TIER.includes(profile?.role)) return json({ error: "Forbidden" }, 403);
  }

  const token = Deno.env.get("METRICOOL_TOKEN");
  const userId = Deno.env.get("METRICOOL_USER_ID");
  const blogId = Deno.env.get("METRICOOL_BLOG_ID");
  if (!token || !userId || !blogId) return json({ error: "Metricool credentials not configured" }, 500);

  // Default window is a rolling 30 days: metrics on recent posts keep moving,
  // so re-reading them refreshes the numbers rather than only adding new rows.
  const url = new URL(req.url);
  const days = Math.min(365, Math.max(1, parseInt(url.searchParams.get("days") || "30", 10) || 30));
  const end = ptDayString();
  const start = ptDayString(new Date(Date.now() - days * 86400000));

  try {
    const posts = await fetchAnalyticsPosts({ token, userId, blogId, start, end });

    const { data: accounts, error: acctErr } = await admin
      .from("platform_accounts")
      .select("id, platform")
      .eq("is_active", true)
      .in("platform", ["instagram", "tiktok", "facebook"]);
    if (acctErr) return json({ error: `platform_accounts: ${acctErr.message}` }, 500);

    const accountFor: Record<string, string> = {};
    for (const [network, platform] of Object.entries(NETWORK_PLATFORM)) {
      const row = (accounts || []).find((a) => a.platform === platform);
      if (row) accountFor[network] = row.id;
    }

    const results: Record<string, number> = {};
    const skipped: string[] = [];
    let itemsUpserted = 0;
    let metricsUpserted = 0;

    // captured_at is pinned to the PT day so re-running the sync within a day
    // updates that day's snapshot instead of piling up rows
    // (content_metrics is unique on content_item_id + captured_at).
    const capturedAt = `${end}T00:00:00Z`;

    for (const network of Object.keys(NETWORK_PLATFORM)) {
      const accountId = accountFor[network];
      const mine = posts.filter((p) => p.network === network);
      if (!mine.length) { results[network] = 0; continue; }
      if (!accountId) { skipped.push(`${network}: no active platform_accounts row`); continue; }

      const rows = mine.map((p) => ({
        platform_account_id: accountId,
        external_id: p.externalId,
        title: p.text.slice(0, 200) || null,
        description: p.text || null,
        content_type: contentTypeFor(p.network, p.subtype),
        published_at: p.publishedAt,
        url: p.url,
        thumbnail_url: p.thumbnailUrl,
        duration_seconds: p.durationSeconds === null ? null : Math.round(p.durationSeconds),
        metadata: { source: "metricool_analytics", subtype: p.subtype, ...p.extra },
        updated_at: new Date().toISOString(),
      }));

      const { data: upserted, error: itemErr } = await admin
        .from("content_items")
        .upsert(rows, { onConflict: "platform_account_id,external_id" })
        .select("id, external_id");
      if (itemErr) { skipped.push(`${network}: ${itemErr.message}`); continue; }
      itemsUpserted += upserted?.length || 0;
      results[network] = mine.length;

      const idByExternal = Object.fromEntries((upserted || []).map((r) => [r.external_id, r.id]));
      const metricRows = mine
        .filter((p) => idByExternal[p.externalId])
        .map((p) => {
          // The count columns are NOT NULL, so a metric the platform simply
          // doesn't report has to be written as 0. Record which ones those
          // were, otherwise "TikTok has no saves endpoint" is indistinguishable
          // from "this post got zero saves".
          const unavailable = Object.entries(p.metrics)
            .filter(([, v]) => v === null).map(([k]) => k);
          return {
            content_item_id: idByExternal[p.externalId],
            captured_at: capturedAt,
            views: p.metrics.views ?? 0,
            likes: p.metrics.likes ?? 0,
            comments: p.metrics.comments ?? 0,
            shares: p.metrics.shares ?? 0,
            saves: p.metrics.saves ?? 0,
            engagement_rate: p.metrics.engagement,
            watch_time_seconds: p.metrics.watchTimeSeconds === null ? null : Math.round(p.metrics.watchTimeSeconds),
            avg_view_duration_seconds: p.metrics.avgViewDurationSeconds,
            extra_metrics: { reach: p.metrics.reach, unavailable, ...p.extra },
          };
        });

      if (metricRows.length) {
        const { error: metricErr } = await admin
          .from("content_metrics")
          .upsert(metricRows, { onConflict: "content_item_id,captured_at" });
        if (metricErr) skipped.push(`${network} metrics: ${metricErr.message}`);
        else metricsUpserted += metricRows.length;
      }
    }

    return json({
      ok: true, window: { start, end, days },
      fetched: posts.length, itemsUpserted, metricsUpserted, results, skipped,
    });
  } catch (err) {
    console.error("sync-social-posts failed:", err);
    return json({ error: String(err) }, 500);
  }
});
