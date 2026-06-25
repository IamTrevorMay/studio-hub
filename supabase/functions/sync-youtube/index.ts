import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  getSupabaseAdmin,
  getActiveAccounts,
  updateLastSynced,
  startIngestionLog,
  completeIngestionLog,
  failIngestionLog,
  fetchWithRetry,
  jsonResponse,
  errorResponse,
} from "./shared/utils.ts";
import { parseDuration } from "./parseDuration.ts";

const YT_API_BASE = "https://www.googleapis.com/youtube/v3";
const YT_ANALYTICS_API = "https://youtubeanalytics.googleapis.com/v2/reports";

// Per-channel refresh token mapping
const CHANNEL_TOKEN_MAP: Record<string, string> = {
  "More Mayday": "YOUTUBE_REFRESH_TOKEN_MAYDAY",
};

async function getAccessToken(accountName?: string): Promise<string | null> {
  const clientId = Deno.env.get("YOUTUBE_CLIENT_ID");
  const clientSecret = Deno.env.get("YOUTUBE_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;

  const tokenEnvVar = (accountName && CHANNEL_TOKEN_MAP[accountName]) || "YOUTUBE_REFRESH_TOKEN";
  const refreshToken = Deno.env.get(tokenEnvVar);
  if (!refreshToken) {
    console.log(`No refresh token found for ${accountName} (tried ${tokenEnvVar})`);
    return null;
  }
  console.log(`Using token ${tokenEnvVar} for ${accountName}`);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    // Don't log the raw body — Google occasionally echoes parts of the
    // refresh_token in error payloads on misformed requests.
    console.error(`OAuth token refresh failed for ${accountName}: HTTP ${res.status}`);
    return null;
  }
  const data = await res.json();
  return data.access_token;
}

async function fetchRevenue(
  accessToken: string,
  channelId: string,
  startDate: string,
  endDate: string
): Promise<Array<{ date: string; revenue: number; adRevenue: number; estimatedRedAdRevenue: number; grossRevenue: number }>> {
  const url = `${YT_ANALYTICS_API}?ids=channel==${channelId}&startDate=${startDate}&endDate=${endDate}&metrics=estimatedRevenue,estimatedAdRevenue,estimatedRedPartnerRevenue,grossRevenue&dimensions=day&sort=day`;
  const res = await fetchWithRetry(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error(`YouTube Analytics API error: ${res.status} ${errText}`);
    return [];
  }
  const data = await res.json();
  return (data.rows || []).map((row: any[]) => ({
    date: row[0],
    revenue: row[1] || 0,
    adRevenue: row[2] || 0,
    estimatedRedAdRevenue: row[3] || 0,
    grossRevenue: row[4] || 0,
  }));
}

async function fetchDailyAnalytics(
  accessToken: string,
  channelId: string,
  startDate: string,
  endDate: string
): Promise<Array<{
  date: string;
  views: number;
  estimatedMinutesWatched: number;
  subscribersGained: number;
  subscribersLost: number;
  likes: number;
  comments: number;
  shares: number;
}>> {
  // Note: `impressions` and `impressionsClickThroughRate` are NOT exposed by
  // the YouTube Analytics v2 API (returns 400 "Unknown identifier"). Those
  // columns in analytics_youtube_daily are populated by CSV uploads out of
  // YouTube Studio, not by this sync.
  const url = `${YT_ANALYTICS_API}?ids=channel==${channelId}&startDate=${startDate}&endDate=${endDate}&metrics=views,estimatedMinutesWatched,subscribersGained,subscribersLost,likes,comments,shares&dimensions=day&sort=day`;
  const res = await fetchWithRetry(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error(`YouTube Daily Analytics API error: ${res.status} ${errText}`);
    return [];
  }
  const data = await res.json();
  return (data.rows || []).map((row: any[]) => ({
    date: row[0],
    views: row[1] || 0,
    estimatedMinutesWatched: row[2] || 0,
    subscribersGained: row[3] || 0,
    subscribersLost: row[4] || 0,
    likes: row[5] || 0,
    comments: row[6] || 0,
    shares: row[7] || 0,
  }));
}

async function fetchAllVideoIds(uploadsPlaylistId: string, apiKey: string): Promise<string[]> {
  const allVideoIds: string[] = [];
  let pageToken: string | undefined = undefined;

  do {
    let url = `${YT_API_BASE}/playlistItems?part=contentDetails&playlistId=${uploadsPlaylistId}&maxResults=50&key=${apiKey}`;
    if (pageToken) url += `&pageToken=${pageToken}`;

    const res = await fetchWithRetry(url);
    const data = await res.json();

    if (data.error) {
      console.error(`YouTube API error fetching playlist ${uploadsPlaylistId}:`, JSON.stringify(data.error));
      throw new Error(`YouTube API error: ${data.error.message || data.error.code || 'unknown'}`);
    }

    const ids = (data.items || [])
      .map((item: any) => item.contentDetails?.videoId)
      .filter(Boolean);
    allVideoIds.push(...ids);

    pageToken = data.nextPageToken;
    console.log(`Fetched ${ids.length} video IDs (total: ${allVideoIds.length}, hasMore: ${!!pageToken})`);
  } while (pageToken);

  return allVideoIds;
}

serve(async (req) => {
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
    const apiKey = Deno.env.get("YOUTUBE_API_KEY");
    if (!apiKey) return errorResponse("Missing YOUTUBE_API_KEY", 500);

    const url = new URL(req.url);
    const targetChannel = url.searchParams.get("channel");
    const mode = url.searchParams.get("mode") || "all";

    let accounts = await getActiveAccounts(supabase, "youtube");
    if (accounts.length === 0) return jsonResponse({ message: "No active YouTube accounts" });

    if (targetChannel) {
      accounts = accounts.filter((a: any) =>
        a.account_name.toLowerCase().includes(targetChannel.toLowerCase())
      );
      if (accounts.length === 0) return errorResponse(`No account matching '${targetChannel}'`, 404);
    }

    const results = [];

    for (const account of accounts) {
      const logId = await startIngestionLog(supabase, account.id, "content_sync");
      let processed = 0;
      let created = 0;
      let updated = 0;
      let failed = 0;
      let videoIds: string[] = [];
      let existingExtIds = new Set<string>();
      let newestPublishedAt: string | null = null;

      try {
        const channelId = account.external_id;

        // Fetch channel stats + creation date
        const channelRes = await fetchWithRetry(
          `${YT_API_BASE}/channels?part=statistics,snippet&id=${channelId}&key=${apiKey}`
        );
        const channelData = await channelRes.json();
        const channelStats = channelData.items?.[0]?.statistics;
        const channelCreatedAt = channelData.items?.[0]?.snippet?.publishedAt;

        if (channelStats) {
          const today = new Date().toISOString().split("T")[0];
          await supabase.from("audience_snapshots").upsert(
            {
              platform_account_id: account.id,
              date: today,
              followers_total: parseInt(channelStats.subscriberCount || "0"),
              followers_gained: 0,
              metadata: {
                total_views: channelStats.viewCount,
                total_videos: channelStats.videoCount,
              },
            },
            { onConflict: "platform_account_id,date" }
          );

          const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
          const { data: yesterdaySnap } = await supabase
            .from("audience_snapshots")
            .select("followers_total")
            .eq("platform_account_id", account.id)
            .eq("date", yesterday)
            .single();

          if (yesterdaySnap) {
            const gained = parseInt(channelStats.subscriberCount) - yesterdaySnap.followers_total;
            await supabase
              .from("audience_snapshots")
              .update({ followers_gained: gained })
              .eq("platform_account_id", account.id)
              .eq("date", today);
          }
        }

        // === CONTENT SYNC ===
        if (mode === "content" || mode === "all") {
          const uploadsRes = await fetchWithRetry(
            `${YT_API_BASE}/channels?part=contentDetails&id=${channelId}&key=${apiKey}`
          );
          const uploadsData = await uploadsRes.json();
          const uploadsPlaylistId =
            uploadsData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;

          if (!uploadsPlaylistId) {
            throw new Error("Could not find uploads playlist for channel");
          }

          console.log(`[DIAG] Uploads playlist ID for ${account.account_name}: ${uploadsPlaylistId}`);
          videoIds = await fetchAllVideoIds(uploadsPlaylistId, apiKey);
          console.log(`[DIAG] Total videos from API for ${account.account_name}: ${videoIds.length}`);

          // Snapshot existing external_ids so we can detect new videos after upsert
          const { data: existingItems } = await supabase
            .from("content_items")
            .select("external_id")
            .eq("platform_account_id", account.id);
          existingExtIds = new Set((existingItems || []).map((r: any) => r.external_id));

          // Collect new non-short videos for clip task creation
          const newFullVideos: { videoId: string; title: string; url: string }[] = [];

          const batchSize = 50;
          for (let i = 0; i < videoIds.length; i += batchSize) {
            const batch = videoIds.slice(i, i + batchSize);
            const videosRes = await fetchWithRetry(
              `${YT_API_BASE}/videos?part=snippet,statistics,contentDetails&id=${batch.join(",")}&key=${apiKey}`
            );
            const videosData = await videosRes.json();

            const contentBatch = [];
            const videoMeta: any[] = [];
            for (const video of videosData.items || []) {
              const stats = video.statistics || {};
              const snippet = video.snippet || {};
              const contentDetails = video.contentDetails || {};
              const duration = parseDuration(contentDetails.duration || "PT0S");
              // YouTube Shorts cutoff is 180 seconds (changed from 60 in 2024).
              const isShort = duration > 0 && duration <= 180;
              const views = parseInt(stats.viewCount || "0");
              const likes = parseInt(stats.likeCount || "0");
              const comments = parseInt(stats.commentCount || "0");
              const engagementRate = views > 0 ? (likes + comments) / views : 0;

              contentBatch.push({
                platform_account_id: account.id,
                external_id: video.id,
                title: (snippet.title || "Untitled").substring(0, 500),
                description: (snippet.description || "").substring(0, 500),
                content_type: isShort ? "short" : "video",
                published_at: snippet.publishedAt,
                url: `https://www.youtube.com/watch?v=${video.id}`,
                thumbnail_url:
                  snippet.thumbnails?.maxres?.url ||
                  snippet.thumbnails?.high?.url ||
                  snippet.thumbnails?.default?.url,
                duration_seconds: duration,
                metadata: {
                  channel_title: snippet.channelTitle,
                  tags: (snippet.tags || []).slice(0, 20),
                  category_id: snippet.categoryId,
                },
                updated_at: new Date().toISOString(),
              });
              videoMeta.push({ videoId: video.id, views, likes, comments, engagementRate,
                favoriteCount: parseInt(stats.favoriteCount || "0") });

              // Track newest published_at for freshness detection
              if (snippet.publishedAt && (!newestPublishedAt || snippet.publishedAt > newestPublishedAt)) {
                newestPublishedAt = snippet.publishedAt;
              }

              // Track new non-short videos for clip tasks
              if (!isShort && !existingExtIds.has(video.id)) {
                newFullVideos.push({
                  videoId: video.id,
                  title: (snippet.title || "Untitled").substring(0, 500),
                  url: `https://www.youtube.com/watch?v=${video.id}`,
                });
              }
            }

            if (contentBatch.length > 0) {
              const { error: batchError } = await supabase
                .from("content_items")
                .upsert(contentBatch, { onConflict: "platform_account_id,external_id" });

              if (batchError) {
                console.error(`Batch upsert error: ${batchError.message}`);
                // Fallback: try individual inserts to salvage what we can
                for (const item of contentBatch) {
                  const { error: singleErr } = await supabase
                    .from("content_items")
                    .upsert(item, { onConflict: "platform_account_id,external_id" });
                  if (singleErr) {
                    console.error(`Individual upsert failed for ${item.external_id}: ${singleErr.message}`);
                    failed += 1;
                  } else {
                    processed += 1;
                  }
                }
              } else {
                // Verify all rows actually persisted (silent failures possible)
                const extIds = contentBatch.map(c => c.external_id);
                const { data: items } = await supabase
                  .from("content_items")
                  .select("id, external_id")
                  .eq("platform_account_id", account.id)
                  .in("external_id", extIds);

                const persistedIds = new Set((items || []).map((it: any) => it.external_id));
                const missingItems = contentBatch.filter(c => !persistedIds.has(c.external_id));

                if (missingItems.length > 0) {
                  console.warn(`${missingItems.length} items did not persist after batch upsert, retrying individually`);
                  for (const item of missingItems) {
                    const { error: retryErr } = await supabase
                      .from("content_items")
                      .upsert(item, { onConflict: "platform_account_id,external_id" });
                    if (retryErr) {
                      console.error(`Retry upsert failed for ${item.external_id}: ${retryErr.message}`);
                      failed += 1;
                    } else {
                      // Verify individual retry actually worked
                      const { data: check } = await supabase
                        .from("content_items")
                        .select("id")
                        .eq("platform_account_id", item.platform_account_id)
                        .eq("external_id", item.external_id)
                        .single();
                      if (check) {
                        processed += 1;
                        persistedIds.add(item.external_id);
                      } else {
                        console.error(`Item ${item.external_id} still missing after individual retry`);
                        failed += 1;
                      }
                    }
                  }
                }

                processed += persistedIds.size;

                if (items && items.length > 0) {
                  const idMap = new Map(items.map((it: any) => [it.external_id, it.id]));
                  // Re-query to include any items recovered by individual retry
                  let allItems = items;
                  if (missingItems.length > 0) {
                    const { data: refreshed } = await supabase
                      .from("content_items")
                      .select("id, external_id")
                      .eq("platform_account_id", account.id)
                      .in("external_id", extIds);
                    if (refreshed) {
                      allItems = refreshed;
                      for (const it of refreshed) {
                        idMap.set(it.external_id, it.id);
                      }
                    }
                  }
                  const metricsBatch = videoMeta
                    .filter(vm => idMap.has(vm.videoId))
                    .map(vm => ({
                      content_item_id: idMap.get(vm.videoId),
                      captured_at: new Date().toISOString(),
                      views: vm.views,
                      likes: vm.likes,
                      comments: vm.comments,
                      shares: 0, saves: 0,
                      engagement_rate: vm.engagementRate,
                      watch_time_seconds: 0,
                      extra_metrics: { favorite_count: vm.favoriteCount },
                    }));
                  if (metricsBatch.length > 0) {
                    const { error: metricsErr } = await supabase
                      .from("content_metrics")
                      .insert(metricsBatch);
                    if (metricsErr) {
                      console.error(`Metrics batch error: ${metricsErr.message}`);
                    }
                  }
                }
              }
            }

            console.log(`Batch ${Math.floor(i / batchSize) + 1} for ${account.account_name}: ${processed} ok, ${failed} failed`);
          }

          // === FIRE AUTOMATION EVENTS for new non-short videos ===
          // Verify videos actually persisted before firing events — prevents
          // infinite new_video loop when batch upsert silently drops rows.
          if (newFullVideos.length > 0) {
            const newVideoIds = newFullVideos.map(nv => nv.videoId);
            const { data: persistedRows } = await supabase
              .from("content_items")
              .select("external_id")
              .eq("platform_account_id", account.id)
              .in("external_id", newVideoIds);
            const persistedSet = new Set((persistedRows || []).map((r: any) => r.external_id));
            const verifiedNewVideos = newFullVideos.filter(nv => persistedSet.has(nv.videoId));

            if (verifiedNewVideos.length < newFullVideos.length) {
              console.warn(`Skipping events for ${newFullVideos.length - verifiedNewVideos.length} videos that did not persist in content_items`);
            }

            const supabaseUrl = Deno.env.get("SUPABASE_URL");
            const cronSecret = Deno.env.get("CRON_SECRET");

            for (const nv of verifiedNewVideos) {
              try {
                const resp = await fetch(
                  `${supabaseUrl}/functions/v1/run-automations?secret=${cronSecret}`,
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      event: "new_video",
                      source: account.account_name,
                      payload: {
                        video_id: nv.videoId,
                        video_title: nv.title,
                        video_url: nv.url,
                      },
                    }),
                  },
                );
                if (resp.ok) {
                  console.log(`Fired new_video event for: ${nv.title}`);
                } else {
                  console.error(`run-automations returned ${resp.status} for ${nv.videoId}`);
                }
              } catch (err) {
                console.error(`Failed to fire automation event for ${nv.videoId}:`, err);
              }
            }
          }
        }

        // === REVENUE SYNC (per-channel token) ===
        if (mode === "revenue" || mode === "all") {
          const accessToken = await getAccessToken(account.account_name);
          if (!accessToken) {
            console.log(`No access token for ${account.account_name} — skipping revenue`);
          } else {
            let totalRevenueDays = 0;
            try {
              const endDate = new Date().toISOString().split("T")[0];
              let revenueStart = "2015-01-01";
              if (channelCreatedAt) {
                const createdDate = new Date(channelCreatedAt);
                revenueStart = createdDate.toISOString().split("T")[0];
              }

              const startD = new Date(revenueStart);
              const endD = new Date(endDate);
              let chunkStart = new Date(startD);

              while (chunkStart < endD) {
                const chunkEnd = new Date(chunkStart);
                chunkEnd.setFullYear(chunkEnd.getFullYear() + 1);
                if (chunkEnd > endD) chunkEnd.setTime(endD.getTime());

                const csStr = chunkStart.toISOString().split("T")[0];
                const ceStr = chunkEnd.toISOString().split("T")[0];
                console.log(`Revenue ${account.account_name}: ${csStr} to ${ceStr}`);

                const revenueData = await fetchRevenue(accessToken, channelId, csStr, ceStr);
                totalRevenueDays += revenueData.length;

                const revBatch = revenueData
                  .filter(day => Math.round(day.revenue * 100) > 0)
                  .map(day => ({
                    stripe_event_id: `yt_rev_${channelId}_${day.date}`,
                    platform_account_id: account.id,
                    event_type: "charge",
                    amount_cents: Math.round(day.revenue * 100),
                    net_amount_cents: Math.round(day.revenue * 100),
                    currency: "usd",
                    product_category: "ad_revenue",
                    product_name: `YouTube Ad Revenue - ${account.account_name}`,
                    is_recurring: false,
                    occurred_at: `${day.date}T00:00:00Z`,
                    metadata: {
                      source: "youtube_analytics",
                      channel_id: channelId,
                      account_name: account.account_name,
                      ad_revenue: day.adRevenue,
                      premium_revenue: day.estimatedRedAdRevenue,
                      gross_revenue: day.grossRevenue,
                    },
                  }));

                if (revBatch.length > 0) {
                  const { error: revErr } = await supabase
                    .from("revenue_events")
                    .upsert(revBatch, { onConflict: "stripe_event_id" });
                  if (revErr) console.error(`Revenue upsert error: ${revErr.message}`);
                }

                chunkStart = new Date(chunkEnd);
                chunkStart.setDate(chunkStart.getDate() + 1);
              }
              console.log(`Revenue synced for ${account.account_name}: ${totalRevenueDays} total days`);
            } catch (revErr) {
              console.error(`Revenue sync failed for ${account.account_name}:`, revErr);
            }
          }
        }

        // === DAILY ANALYTICS SYNC (views, watch time, etc.) ===
        if (mode === "daily_analytics" || mode === "all") {
          const accessToken = await getAccessToken(account.account_name);
          if (!accessToken) {
            console.log(`No access token for ${account.account_name} — skipping daily analytics`);
          } else {
            let totalDailyDays = 0;
            try {
              const endDate = new Date().toISOString().split("T")[0];
              let analyticsStart = "2015-01-01";
              if (channelCreatedAt) {
                const createdDate = new Date(channelCreatedAt);
                analyticsStart = createdDate.toISOString().split("T")[0];
              }

              // Derive channel slug from account name
              const channelSlug = (account.account_name || "unknown")
                .toLowerCase().replace(/[^a-z0-9]+/g, "");

              const startD = new Date(analyticsStart);
              const endD = new Date(endDate);
              let chunkStart = new Date(startD);

              while (chunkStart < endD) {
                const chunkEnd = new Date(chunkStart);
                chunkEnd.setFullYear(chunkEnd.getFullYear() + 1);
                if (chunkEnd > endD) chunkEnd.setTime(endD.getTime());

                const csStr = chunkStart.toISOString().split("T")[0];
                const ceStr = chunkEnd.toISOString().split("T")[0];
                console.log(`Daily analytics ${account.account_name}: ${csStr} to ${ceStr}`);

                const dailyData = await fetchDailyAnalytics(accessToken, channelId, csStr, ceStr);
                totalDailyDays += dailyData.length;

                if (dailyData.length > 0) {
                  // Do NOT include impressions / impressions_ctr here — those
                  // columns are CSV-sourced and the Analytics API can't
                  // populate them. Including them would overwrite history.
                  const dailyBatch = dailyData.map(day => ({
                    channel: channelSlug,
                    platform_account_id: account.id,
                    date: day.date,
                    views: day.views,
                    watch_time_hours: parseFloat((day.estimatedMinutesWatched / 60).toFixed(2)),
                    subscribers: day.subscribersGained - day.subscribersLost,
                  }));

                  const { error: dailyErr } = await supabase
                    .from("analytics_youtube_daily")
                    .upsert(dailyBatch, { onConflict: "channel,date" });
                  if (dailyErr) console.error(`Daily analytics upsert error: ${dailyErr.message}`);

                  // Also upsert into platform_daily_metrics so Goals page can track views
                  const pdmBatch = dailyData.map(day => ({
                    platform_account_id: account.id,
                    date: day.date,
                    views: day.views,
                    watch_time_seconds: day.estimatedMinutesWatched * 60,
                    likes: 0,
                    comments: 0,
                    shares: 0,
                    metadata: { source: "youtube-analytics" },
                  }));
                  const { error: pdmErr } = await supabase
                    .from("platform_daily_metrics")
                    .upsert(pdmBatch, { onConflict: "platform_account_id,date" });
                  if (pdmErr) console.error(`PDM upsert error: ${pdmErr.message}`);
                }

                chunkStart = new Date(chunkEnd);
                chunkStart.setDate(chunkStart.getDate() + 1);
              }
              console.log(`Daily analytics synced for ${account.account_name}: ${totalDailyDays} total days`);
            } catch (dailyErr) {
              console.error(`Daily analytics sync failed for ${account.account_name}:`, dailyErr);
            }
          }
        }

        await updateLastSynced(supabase, account.id);

        // Freshness detection: warn if no new videos were found
        if (videoIds.length > 0 && videoIds.length === existingExtIds.size) {
          const daysSinceNewest = newestPublishedAt
            ? Math.round((Date.now() - new Date(newestPublishedAt).getTime()) / 86400000)
            : null;
          console.warn(`[DIAG] STALENESS WARNING for ${account.account_name}: API returned ${videoIds.length} videos, all already in DB. Playlist: ${account.external_id}. Newest content: ${newestPublishedAt || 'unknown'} (${daysSinceNewest != null ? daysSinceNewest + 'd ago' : 'unknown'}). No new videos detected.`);
        } else if (videoIds.length > 0) {
          const newCount = videoIds.length - existingExtIds.size;
          console.log(`[DIAG] ${account.account_name}: ${newCount} new video(s) found out of ${videoIds.length} total. Newest: ${newestPublishedAt || 'unknown'}`);
        }

        await completeIngestionLog(supabase, logId, {
          records_processed: processed,
          records_created: created,
          records_updated: updated,
        }, account.id);

        // Store freshness metadata on the ingestion log
        await supabase.from("ingestion_logs").update({
          metadata: {
            newest_content_at: newestPublishedAt,
            total_api_videos: videoIds.length,
            existing_db_videos: existingExtIds.size,
          },
        }).eq("id", logId);

        results.push({ account: account.account_name, processed, failed, revenue_synced: true, newest_content_at: newestPublishedAt });
      } catch (err) {
        await failIngestionLog(supabase, logId, err as Error, undefined, account.id);
        results.push({ account: account.account_name, error: (err as Error).message });
      }
    }

    // Refresh the materialized view so dashboards pick up new data
    try { await supabase.rpc("refresh_daily_platform_rollups"); }
    catch (e) { console.error("Rollups refresh failed:", e); }

    return jsonResponse({ success: true, results });
  } catch (err) {
    console.error("sync-youtube fatal error:", err);
    return errorResponse((err as Error).message);
  }
});

