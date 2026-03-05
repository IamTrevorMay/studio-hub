// supabase/functions/sync-twitch/index.ts
// Deploy with: supabase functions deploy sync-twitch --no-verify-jwt
// Pulls followers, subscribers, live stream info, and VODs from Twitch Helix API
// Writes to audience_snapshots, platform_daily_metrics, content_items, content_metrics

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const HELIX = "https://api.twitch.tv/helix";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Parse Twitch duration format "3h26m15s" → seconds
 */
function parseTwitchDuration(duration: string): number {
  const match = duration.match(
    /(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/,
  );
  if (!match) return 0;
  const h = parseInt(match[1] || "0");
  const m = parseInt(match[2] || "0");
  const s = parseInt(match[3] || "0");
  return h * 3600 + m * 60 + s;
}

/**
 * Refresh Twitch access token. CRITICAL: old refresh token is invalidated immediately.
 * Returns new tokens or null if refresh failed (user must re-authorize).
 */
async function refreshAccessToken(
  supabase: ReturnType<typeof createClient>,
  accountId: string,
  credentials: { access_token: string; refresh_token: string; token_expires_at: string },
  clientId: string,
  clientSecret: string,
): Promise<{ access_token: string; refresh_token: string } | null> {
  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: credentials.refresh_token,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`CRITICAL: Twitch token refresh failed: ${res.status} ${errText}`);

    // If 400/401, refresh token is revoked — clear credentials so user re-authorizes
    if (res.status === 400 || res.status === 401) {
      console.error("Refresh token revoked. Clearing credentials — user must re-authorize.");
      await supabase
        .from("platform_accounts")
        .update({
          credentials: { error: "refresh_token_revoked", cleared_at: new Date().toISOString() },
        })
        .eq("id", accountId);
    }
    return null;
  }

  const tokens = await res.json();
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  // Write new tokens to DB immediately — old refresh token is already invalidated
  const { error: updateError } = await supabase
    .from("platform_accounts")
    .update({
      credentials: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_expires_at: expiresAt,
      },
    })
    .eq("id", accountId);

  if (updateError) {
    console.error(
      `CRITICAL: Token refreshed but DB write failed! New tokens may be lost. Error: ${updateError.message}`,
    );
  }

  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
  };
}

/**
 * Make an authenticated Twitch Helix API call
 */
async function helix(
  endpoint: string,
  accessToken: string,
  clientId: string,
): Promise<{ ok: boolean; data: any; status: number }> {
  const res = await fetch(`${HELIX}${endpoint}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Client-Id": clientId,
    },
  });
  const body = await res.json();
  return { ok: res.ok, data: body, status: res.status };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const clientId = Deno.env.get("TWITCH_CLIENT_ID");
  const clientSecret = Deno.env.get("TWITCH_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    return jsonResponse({ error: "Twitch credentials not configured" }, 500);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Load Twitch account
  const { data: account, error: accountError } = await supabase
    .from("platform_accounts")
    .select("*")
    .eq("platform", "twitch")
    .eq("is_active", true)
    .single();

  if (accountError || !account) {
    return jsonResponse({ error: "No active Twitch account found" }, 404);
  }

  const credentials = account.credentials as {
    access_token?: string;
    refresh_token?: string;
    token_expires_at?: string;
    error?: string;
  };

  if (!credentials?.refresh_token) {
    return jsonResponse(
      { error: "Twitch not authorized. Complete OAuth flow first.", credentials_state: credentials },
      401,
    );
  }

  // Start ingestion log
  const { data: logEntry } = await supabase
    .from("ingestion_logs")
    .insert({
      platform_account_id: account.id,
      job_type: "twitch_sync",
      status: "running",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  const logId = logEntry?.id;
  const errors: Record<string, string> = {};
  const results: Record<string, unknown> = {};

  try {
    // ── 1. Refresh access token ──
    const newTokens = await refreshAccessToken(
      supabase,
      account.id,
      credentials as { access_token: string; refresh_token: string; token_expires_at: string },
      clientId,
      clientSecret,
    );

    if (!newTokens) {
      throw new Error("Token refresh failed — user must re-authorize Twitch");
    }

    const accessToken = newTokens.access_token;
    const broadcasterId = account.external_id;
    const today = new Date().toISOString().split("T")[0];

    // ── 2. Fetch followers ──
    let followersTotal = 0;
    let followersGained = 0;
    try {
      const followRes = await helix(
        `/channels/followers?broadcaster_id=${broadcasterId}&first=1`,
        accessToken,
        clientId,
      );
      if (followRes.ok) {
        followersTotal = followRes.data.total || 0;
        results.followers = followersTotal;

        // Get yesterday's snapshot for delta
        const yesterday = new Date(Date.now() - 86400000)
          .toISOString()
          .split("T")[0];
        const { data: yesterdaySnap } = await supabase
          .from("audience_snapshots")
          .select("followers_total")
          .eq("platform_account_id", account.id)
          .eq("date", yesterday)
          .single();

        if (yesterdaySnap) {
          followersGained = followersTotal - yesterdaySnap.followers_total;
        }
      } else {
        errors.followers = `${followRes.status}: ${JSON.stringify(followRes.data)}`;
      }
    } catch (e) {
      errors.followers = (e as Error).message;
    }

    // ── 3. Fetch subscribers (may fail if not Affiliate/Partner) ──
    let subscriberCount: number | null = null;
    let subscriberPoints: number | null = null;
    try {
      const subRes = await helix(
        `/subscriptions?broadcaster_id=${broadcasterId}`,
        accessToken,
        clientId,
      );
      if (subRes.ok) {
        subscriberCount = subRes.data.total || 0;
        subscriberPoints = subRes.data.points || 0;
        results.subscribers = subscriberCount;
        results.subscriber_points = subscriberPoints;
      } else {
        // 403 is expected for non-Affiliate/Partner channels
        errors.subscribers = `${subRes.status}: ${JSON.stringify(subRes.data)}`;
      }
    } catch (e) {
      errors.subscribers = (e as Error).message;
    }

    // ── 4. Upsert audience_snapshots ──
    if (followersTotal > 0) {
      const audienceMetadata: Record<string, unknown> = { source: "twitch_helix" };
      if (subscriberCount !== null) audienceMetadata.subscriber_count = subscriberCount;
      if (subscriberPoints !== null) audienceMetadata.subscriber_points = subscriberPoints;

      const { error: audError } = await supabase
        .from("audience_snapshots")
        .upsert(
          {
            platform_account_id: account.id,
            date: today,
            followers_total: followersTotal,
            followers_gained: followersGained,
            demographics: {},
            metadata: audienceMetadata,
          },
          { onConflict: "platform_account_id,date" },
        );
      if (audError) errors.audience_upsert = audError.message;
      else results.audience_snapshot = "upserted";
    }

    // ── 5. Check live stream ──
    let isLive = false;
    let viewerCount = 0;
    let streamTitle = "";
    let gameName = "";
    try {
      const streamRes = await helix(
        `/streams?user_id=${broadcasterId}`,
        accessToken,
        clientId,
      );
      if (streamRes.ok && streamRes.data.data?.length > 0) {
        const stream = streamRes.data.data[0];
        isLive = true;
        viewerCount = stream.viewer_count || 0;
        streamTitle = stream.title || "";
        gameName = stream.game_name || "";
        results.live = { viewer_count: viewerCount, title: streamTitle, game: gameName };
      } else {
        results.live = false;
      }
    } catch (e) {
      errors.stream = (e as Error).message;
    }

    // ── 6. Upsert platform_daily_metrics ──
    {
      const pdmMetadata: Record<string, unknown> = {
        source: "twitch_helix",
        is_live: isLive,
      };
      if (isLive) {
        pdmMetadata.viewer_count = viewerCount;
        pdmMetadata.stream_title = streamTitle;
        pdmMetadata.game_name = gameName;
      }

      const { error: pdmError } = await supabase
        .from("platform_daily_metrics")
        .upsert(
          {
            platform_account_id: account.id,
            date: today,
            views: isLive ? viewerCount : 0,
            likes: 0,
            comments: 0,
            shares: 0,
            metadata: pdmMetadata,
          },
          { onConflict: "platform_account_id,date" },
        );
      if (pdmError) errors.pdm_upsert = pdmError.message;
      else results.daily_metrics = "upserted";
    }

    // ── 7. Fetch recent VODs ──
    let vodsProcessed = 0;
    try {
      const vodRes = await helix(
        `/videos?user_id=${broadcasterId}&type=archive&first=20`,
        accessToken,
        clientId,
      );
      if (vodRes.ok && vodRes.data.data?.length > 0) {
        const vods = vodRes.data.data;

        // Upsert content_items
        const contentBatch = vods.map((vod: any) => ({
          platform_account_id: account.id,
          external_id: vod.id,
          title: (vod.title || "Untitled").substring(0, 500),
          content_type: "video",
          published_at: vod.created_at,
          url: vod.url,
          thumbnail_url: vod.thumbnail_url
            ?.replace("%{width}", "640")
            .replace("%{height}", "360") || null,
          duration_seconds: parseTwitchDuration(vod.duration || "0s"),
          metadata: {
            stream_id: vod.stream_id,
            language: vod.language,
            type: vod.type,
          },
          updated_at: new Date().toISOString(),
        }));

        const { error: contentError } = await supabase
          .from("content_items")
          .upsert(contentBatch, {
            onConflict: "platform_account_id,external_id",
          });

        if (contentError) {
          errors.content_upsert = contentError.message;
        } else {
          vodsProcessed = contentBatch.length;

          // Fetch content_item IDs for metrics insertion
          const extIds = contentBatch.map((c: any) => c.external_id);
          const { data: items } = await supabase
            .from("content_items")
            .select("id, external_id")
            .eq("platform_account_id", account.id)
            .in("external_id", extIds);

          if (items && items.length > 0) {
            const idMap = new Map(
              items.map((it: any) => [it.external_id, it.id]),
            );
            const metricsBatch = vods
              .filter((vod: any) => idMap.has(vod.id))
              .map((vod: any) => ({
                content_item_id: idMap.get(vod.id),
                captured_at: new Date().toISOString(),
                views: vod.view_count || 0,
                likes: 0,
                comments: 0,
                shares: 0,
                saves: 0,
                engagement_rate: 0,
                watch_time_seconds: 0,
                extra_metrics: {
                  duration_seconds: parseTwitchDuration(vod.duration || "0s"),
                },
              }));

            if (metricsBatch.length > 0) {
              const { error: metricsError } = await supabase
                .from("content_metrics")
                .insert(metricsBatch);
              if (metricsError)
                errors.content_metrics = metricsError.message;
            }
          }
        }

        results.vods_processed = vodsProcessed;
      } else {
        results.vods_processed = 0;
      }
    } catch (e) {
      errors.vods = (e as Error).message;
    }

    // ── 8. Update last_synced_at ──
    await supabase
      .from("platform_accounts")
      .update({ last_synced_at: new Date().toISOString() })
      .eq("id", account.id);

    // ── 9. Complete ingestion log ──
    if (logId) {
      await supabase
        .from("ingestion_logs")
        .update({
          status: "success",
          records_processed: vodsProcessed + (followersTotal > 0 ? 2 : 1),
          records_created: vodsProcessed,
          completed_at: new Date().toISOString(),
          metadata: {
            followers: followersTotal,
            subscribers: subscriberCount,
            vods: vodsProcessed,
            is_live: isLive,
            ...(Object.keys(errors).length > 0 ? { partial_errors: errors } : {}),
          },
        })
        .eq("id", logId);
    }

    // ── 10. Refresh materialized view ──
    try {
      await supabase.rpc("refresh_daily_platform_rollups");
      results.rollups_refreshed = true;
    } catch (e) {
      results.rollups_refreshed = false;
      errors.rollups = (e as Error).message;
    }

    return jsonResponse({
      ok: true,
      results,
      ...(Object.keys(errors).length > 0 ? { partial_errors: errors } : {}),
    });
  } catch (err) {
    console.error("sync-twitch fatal error:", err);

    // Fail ingestion log
    if (logId) {
      try {
        await supabase
          .from("ingestion_logs")
          .update({
            status: "failed",
            error_message: (err as Error).message,
            completed_at: new Date().toISOString(),
          })
          .eq("id", logId);
      } catch (_) {
        // ignore log update failure
      }
    }

    return jsonResponse(
      {
        ok: false,
        error: (err as Error).message,
        partial_errors: errors,
        partial_results: results,
      },
      500,
    );
  }
});
