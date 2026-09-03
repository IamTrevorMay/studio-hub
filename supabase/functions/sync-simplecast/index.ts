// supabase/functions/sync-simplecast/index.ts
// Pulls podcast download analytics from Simplecast.
//
// Per active platform_accounts row (platform='simplecast'):
//   - credentials.api_token  → Simplecast API token (the raw base64 string from
//                              the Private Apps page; sent verbatim as Bearer)
//   - external_id            → Simplecast podcast id
//
// Stores:
//   - platform_daily_metrics: one row per day, views = that day's downloads_total
//     (from the podcast-level /analytics/downloads by_interval daily series — a
//     true per-day value, no cumulative delta needed). Last ~35 days each run.
//   - content_items + content_metrics per episode (content_type='podcast_episode').
//     Per-episode download totals fetched only for recently-published episodes
//     (keeps the brief's "top content this week" populated without 100+ calls/run).
//
// Verified live against the Simplecast API 2026-06-28: auth = Bearer <raw token>,
// /analytics/downloads?podcast=… returns { total, by_interval:[{interval,downloads_total}] },
// episode list at /podcasts/{id}/episodes (keys include id,title,published_at,number,duration).
//
// Auth: CRON_SECRET (x-cron-secret header or ?secret=) or an admin JWT.
// Deploy: supabase functions deploy sync-simplecast --no-verify-jwt

import {
  getSupabaseAdmin,
  getActiveAccounts,
  updateLastSynced,
  startIngestionLog,
  completeIngestionLog,
  failIngestionLog,
  upsertContentWithMetrics,
  fetchWithRetry,
  jsonResponse,
  errorResponse,
} from "../shared/utils.ts";

// Admin tier = admin + director (mirrors the DB is_admin() helper and the
// client-side isAdminTier). Directors are restricted in the UI, not here.
const ADMIN_TIER = ["admin", "director"];

const SC_BASE = "https://api.simplecast.com";
const RECENT_DAYS = 35; // window for daily metrics + per-episode download fetches

async function scGet(path: string, token: string): Promise<any> {
  const res = await fetchWithRetry(`${SC_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Simplecast GET ${path} → HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

Deno.serve(async (req) => {
  try {
    // ── auth: CRON_SECRET or admin JWT ──
    {
      const _expected = Deno.env.get("CRON_SECRET");
      const _provided = req.headers.get("x-cron-secret")
        ?? new URL(req.url).searchParams.get("secret");
      const _isCron = !!_expected && _provided === _expected;
      if (!_isCron) {
        const _auth = req.headers.get("Authorization");
        if (!_auth?.startsWith("Bearer ")) return errorResponse("Unauthorized", 401);
        const _adminClient = getSupabaseAdmin();
        const { data: { user: _u } } = await _adminClient.auth.getUser(_auth.slice(7));
        if (!_u) return errorResponse("Unauthorized", 401);
        const { data: _profile } = await _adminClient
          .from("profiles").select("role").eq("id", _u.id).single();
        if (!ADMIN_TIER.includes(_profile?.role)) return errorResponse("Forbidden", 403);
      }
    }

    const supabase = getSupabaseAdmin();
    const accounts = await getActiveAccounts(supabase, "simplecast");
    if (accounts.length === 0) return jsonResponse({ message: "No active Simplecast accounts" });

    const cutoff = new Date(Date.now() - RECENT_DAYS * 86400_000).toISOString().slice(0, 10);
    const results = [];

    for (const account of accounts) {
      const logId = await startIngestionLog(supabase, account.id, "simplecast_sync");
      let processed = 0, created = 0, updated = 0;

      try {
        const token = (account.credentials as { api_token?: string })?.api_token;
        const podcastId = account.external_id;
        if (!token) throw new Error("Missing Simplecast api_token in account.credentials");
        if (!podcastId) throw new Error("Missing Simplecast podcast id in account.external_id");

        // ── daily downloads (per-day series) → platform_daily_metrics ──
        const dl = await scGet(`/analytics/downloads?podcast=${podcastId}`, token);
        const series: any[] = Array.isArray(dl?.by_interval) ? dl.by_interval : [];
        const recent = series.filter((d) => (d.interval || "") >= cutoff);
        if (recent.length) {
          const rows = recent.map((d) => ({
            platform_account_id: account.id,
            date: d.interval,
            views: Number(d.downloads_total) || 0, // daily downloads stored in views
            likes: 0, comments: 0, shares: 0,
            metadata: { source: "simplecast", metric: "downloads" },
            updated_at: new Date().toISOString(),
          }));
          const { error: pdmErr } = await supabase
            .from("platform_daily_metrics")
            .upsert(rows, { onConflict: "platform_account_id,date" });
          if (pdmErr) throw new Error(`platform_daily_metrics upsert failed: ${pdmErr.message}`);
        }

        // ── episodes → content_items (+ per-episode downloads for recent ones) ──
        const epData = await scGet(`/podcasts/${podcastId}/episodes?limit=300`, token);
        const episodes: any[] = epData?.collection || [];

        for (const ep of episodes) {
          const epId = ep.id;
          if (!epId) continue;
          const pub = ep.published_at ? new Date(ep.published_at).toISOString() : undefined;
          const isRecent = !!pub && pub.slice(0, 10) >= cutoff;

          // Only spend an analytics call on recently-published episodes.
          let epDownloads = 0;
          if (isRecent) {
            try {
              const epDl = await scGet(`/analytics/downloads?episode=${epId}`, token);
              epDownloads = Number(epDl?.total) || 0;
            } catch (e) {
              console.warn(`Simplecast episode ${epId} downloads failed: ${(e as Error).message}`);
            }
          }

          const result = await upsertContentWithMetrics(
            supabase,
            {
              platform_account_id: account.id,
              external_id: String(epId),
              title: ep.title || "(untitled episode)",
              description: (ep.description || "").toString().slice(0, 500),
              content_type: "podcast",
              published_at: pub,
              url: ep.enclosure_url || undefined,
              thumbnail_url: ep.image_url || undefined,
              duration_seconds: ep.duration ? Number(ep.duration) : undefined,
              metadata: { season: ep.season?.number, number: ep.number },
            },
            isRecent
              ? { views: epDownloads, extra_metrics: { source: "simplecast", metric: "downloads" } }
              : { extra_metrics: { source: "simplecast", metric: "downloads", skipped: "not_recent" } }
          );
          processed++;
          if (result.created) created++; else updated++;
        }

        await updateLastSynced(supabase, account.id);
        await completeIngestionLog(supabase, logId, {
          records_processed: processed,
          records_created: created,
          records_updated: updated,
        }, account.id);
        results.push({
          account: account.account_name,
          all_time_downloads: Number(dl?.total) || 0,
          days_written: recent.length,
          episodes: episodes.length,
        });
      } catch (err) {
        await failIngestionLog(supabase, logId, err as Error, undefined, account.id);
        results.push({ account: account.account_name, error: (err as Error).message });
      }
    }

    // Refresh the materialized view so dashboards pick up new data
    try {
      await getSupabaseAdmin().rpc("refresh_daily_platform_rollups");
    } catch (e) { console.error("Rollups refresh failed:", e); }

    return jsonResponse({ success: true, results });
  } catch (err) {
    console.error("sync-simplecast fatal error:", err);
    return errorResponse((err as Error).message);
  }
});
