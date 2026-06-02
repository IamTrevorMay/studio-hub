// supabase/functions/sync-meta/index.ts
// Syncs content and metrics from Facebook Page + Instagram Business Account

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

const GRAPH_API = "https://graph.facebook.com/v19.0";

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
    const accessToken = Deno.env.get("META_ACCESS_TOKEN");
    if (!accessToken) return errorResponse("Missing META_ACCESS_TOKEN", 500);

    const results = [];

    // FACEBOOK
    const fbAccounts = await getActiveAccounts(supabase, "facebook");

    for (const account of fbAccounts) {
      const logId = await startIngestionLog(supabase, account.id, "content_sync");
      let processed = 0, created = 0, updated = 0;

      try {
        const pageId = account.external_id;

        const pageRes = await fetchWithRetry(
          `${GRAPH_API}/${pageId}?fields=followers_count,fan_count,name&access_token=${accessToken}`
        );
        const pageData = await pageRes.json();

        if (pageData.followers_count || pageData.fan_count) {
          const today = new Date().toISOString().split("T")[0];
          await supabase.from("audience_snapshots").upsert(
            {
              platform_account_id: account.id,
              date: today,
              followers_total: pageData.followers_count || pageData.fan_count || 0,
            },
            { onConflict: "platform_account_id,date" }
          );
        }

        const postsRes = await fetchWithRetry(
          `${GRAPH_API}/${pageId}/posts?fields=id,message,created_time,permalink_url,full_picture,type,shares&limit=50&access_token=${accessToken}`
        );
        const postsData = await postsRes.json();

        for (const post of postsData.data || []) {
          const insightsRes = await fetchWithRetry(
            `${GRAPH_API}/${post.id}/insights?metric=post_impressions,post_engaged_users,post_clicks,post_reactions_by_type_total&access_token=${accessToken}`
          );
          const insightsData = await insightsRes.json();

          const metrics: Record<string, number> = {};
          for (const insight of insightsData.data || []) {
            metrics[insight.name] = insight.values?.[0]?.value || 0;
          }

          const impressions = metrics.post_impressions || 0;
          const engagedUsers = metrics.post_engaged_users || 0;
          const clicks = metrics.post_clicks || 0;
          const shares = post.shares?.count || 0;
          const reactions = typeof metrics.post_reactions_by_type_total === "object"
            ? Object.values(metrics.post_reactions_by_type_total as Record<string, number>).reduce((a, b) => a + b, 0)
            : 0;

          const contentType = post.type === "video" ? "video" : "post";
          const engagementRate = impressions > 0 ? engagedUsers / impressions : 0;

          const result = await upsertContentWithMetrics(
            supabase,
            {
              platform_account_id: account.id,
              external_id: post.id,
              title: post.message?.substring(0, 200) || "(No text)",
              content_type: contentType,
              published_at: post.created_time,
              url: post.permalink_url,
              thumbnail_url: post.full_picture,
              metadata: { type: post.type },
            },
            {
              views: impressions,
              likes: reactions,
              comments: 0,
              shares,
              clicks,
              engagement_rate: engagementRate,
              extra_metrics: {
                engaged_users: engagedUsers,
                reactions_breakdown: metrics.post_reactions_by_type_total,
              },
            }
          );

          processed++;
          if (result.created) created++; else updated++;
        }

        await updateLastSynced(supabase, account.id);
        await completeIngestionLog(supabase, logId, { records_processed: processed, records_created: created, records_updated: updated });
        results.push({ account: account.account_name, platform: "facebook", processed, created, updated });
      } catch (err) {
        await failIngestionLog(supabase, logId, err as Error);
        results.push({ account: account.account_name, platform: "facebook", error: (err as Error).message });
      }
    }

    // INSTAGRAM
    const igAccounts = await getActiveAccounts(supabase, "instagram");

    for (const account of igAccounts) {
      const logId = await startIngestionLog(supabase, account.id, "content_sync");
      let processed = 0, created = 0, updated = 0;

      try {
        const igUserId = account.external_id;

        const profileRes = await fetchWithRetry(
          `${GRAPH_API}/${igUserId}?fields=followers_count,follows_count,media_count,name&access_token=${accessToken}`
        );
        const profileData = await profileRes.json();

        if (profileData.followers_count) {
          const today = new Date().toISOString().split("T")[0];
          await supabase.from("audience_snapshots").upsert(
            {
              platform_account_id: account.id,
              date: today,
              followers_total: profileData.followers_count,
              following_total: profileData.follows_count,
              metadata: { media_count: profileData.media_count },
            },
            { onConflict: "platform_account_id,date" }
          );
        }

        const mediaRes = await fetchWithRetry(
          `${GRAPH_API}/${igUserId}/media?fields=id,caption,media_type,media_url,permalink,thumbnail_url,timestamp&limit=50&access_token=${accessToken}`
        );
        const mediaData = await mediaRes.json();

        for (const media of mediaData.data || []) {
          const metricsToFetch = media.media_type === "VIDEO"
            ? "impressions,reach,engagement,saved,video_views"
            : "impressions,reach,engagement,saved";

          let insightsData: any = { data: [] };
          try {
            const insightsRes = await fetchWithRetry(
              `${GRAPH_API}/${media.id}/insights?metric=${metricsToFetch}&access_token=${accessToken}`
            );
            insightsData = await insightsRes.json();
          } catch {
            // Insights may not be available for all media types
          }

          const igMetrics: Record<string, number> = {};
          for (const insight of insightsData.data || []) {
            igMetrics[insight.name] = insight.values?.[0]?.value || 0;
          }

          const impressions = igMetrics.impressions || 0;
          const reach = igMetrics.reach || 0;
          const engagement = igMetrics.engagement || 0;
          const saves = igMetrics.saved || 0;
          const videoViews = igMetrics.video_views || 0;

          const contentType =
            media.media_type === "VIDEO" ? "reel" :
            media.media_type === "CAROUSEL_ALBUM" ? "post" : "post";

          const engagementRate = reach > 0 ? engagement / reach : 0;

          const result = await upsertContentWithMetrics(
            supabase,
            {
              platform_account_id: account.id,
              external_id: media.id,
              title: media.caption?.substring(0, 200) || "(No caption)",
              content_type: contentType,
              published_at: media.timestamp,
              url: media.permalink,
              thumbnail_url: media.thumbnail_url || media.media_url,
              metadata: { media_type: media.media_type },
            },
            {
              views: impressions,
              likes: engagement,
              shares: 0,
              saves,
              engagement_rate: engagementRate,
              extra_metrics: {
                reach,
                video_views: videoViews,
              },
            }
          );

          processed++;
          if (result.created) created++; else updated++;
        }

        await updateLastSynced(supabase, account.id);
        await completeIngestionLog(supabase, logId, { records_processed: processed, records_created: created, records_updated: updated });
        results.push({ account: account.account_name, platform: "instagram", processed, created, updated });
      } catch (err) {
        await failIngestionLog(supabase, logId, err as Error);
        results.push({ account: account.account_name, platform: "instagram", error: (err as Error).message });
      }
    }

    return jsonResponse({ success: true, results });
  } catch (err) {
    console.error("sync-meta fatal error:", err);
    return errorResponse((err as Error).message);
  }
});
