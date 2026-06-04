// supabase/functions/sync-tiktok/index.ts
// Syncs content and metrics from TikTok Business API

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

const TT_API_BASE = "https://business-api.tiktok.com/open_api/v1.3";

Deno.serve(async (req) => {
  try {
    // Auth: CRON_SECRET (header or query) or admin JWT required
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
        if (_profile?.role !== "admin") return errorResponse("Forbidden", 403);
      }
    }

    const supabase = getSupabaseAdmin();
    const accessToken = Deno.env.get("TIKTOK_ACCESS_TOKEN");
    if (!accessToken) return errorResponse("Missing TIKTOK_ACCESS_TOKEN", 500);

    const accounts = await getActiveAccounts(supabase, "tiktok");
    if (accounts.length === 0) return jsonResponse({ message: "No active TikTok accounts" });

    const results = [];
    const headers = {
      "Access-Token": accessToken,
      "Content-Type": "application/json",
    };

    for (const account of accounts) {
      const logId = await startIngestionLog(supabase, account.id, "content_sync");
      let processed = 0, created = 0, updated = 0;

      try {
        const businessId = account.external_id;

        const accountRes = await fetchWithRetry(
          `${TT_API_BASE}/business/get/?business_id=${businessId}&fields=["display_name","follower_count","following_count","likes_count","video_count","profile_image"]`,
          { headers }
        );
        const accountData = await accountRes.json();
        const accountInfo = accountData.data;

        if (accountInfo?.follower_count !== undefined) {
          const today = new Date().toISOString().split("T")[0];
          await supabase.from("audience_snapshots").upsert(
            {
              platform_account_id: account.id,
              date: today,
              followers_total: accountInfo.follower_count,
              following_total: accountInfo.following_count,
              metadata: {
                likes_count: accountInfo.likes_count,
                video_count: accountInfo.video_count,
              },
            },
            { onConflict: "platform_account_id,date" }
          );
        }

        const videosRes = await fetchWithRetry(
          `${TT_API_BASE}/business/video/list/`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              business_id: businessId,
              fields: [
                "item_id", "title", "create_time", "share_url",
                "thumbnail_url", "duration", "video_views",
                "likes", "comments", "shares", "reach",
                "video_duration", "average_time_watched"
              ],
              max_count: 50,
            }),
          }
        );
        const videosData = await videosRes.json();

        for (const video of videosData.data?.videos || []) {
          const views = video.video_views || 0;
          const likes = video.likes || 0;
          const comments = video.comments || 0;
          const shares = video.shares || 0;
          const reach = video.reach || 0;
          const duration = video.duration || video.video_duration || 0;

          const engagementRate = views > 0 ? (likes + comments + shares) / views : 0;

          const result = await upsertContentWithMetrics(
            supabase,
            {
              platform_account_id: account.id,
              external_id: video.item_id,
              title: video.title || "(No caption)",
              content_type: (duration > 0 && duration <= 180) ? "short" : "video",
              published_at: video.create_time
                ? new Date(video.create_time * 1000).toISOString()
                : undefined,
              url: video.share_url,
              thumbnail_url: video.thumbnail_url,
              duration_seconds: duration,
              metadata: {},
            },
            {
              views,
              likes,
              comments,
              shares,
              engagement_rate: engagementRate,
              watch_time_seconds: 0,
              avg_view_duration_seconds: video.average_time_watched || 0,
              extra_metrics: { reach },
            }
          );

          processed++;
          if (result.created) created++; else updated++;
        }

        await updateLastSynced(supabase, account.id);
        await completeIngestionLog(supabase, logId, {
          records_processed: processed,
          records_created: created,
          records_updated: updated,
        });
        results.push({ account: account.account_name, processed, created, updated });
      } catch (err) {
        await failIngestionLog(supabase, logId, err as Error);
        results.push({ account: account.account_name, error: (err as Error).message });
      }
    }

    return jsonResponse({ success: true, results });
  } catch (err) {
    console.error("sync-tiktok fatal error:", err);
    return errorResponse((err as Error).message);
  }
});
