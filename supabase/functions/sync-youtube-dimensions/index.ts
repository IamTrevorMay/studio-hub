import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSupabaseAdmin, getActiveAccounts, startIngestionLog, completeIngestionLog, failIngestionLog, fetchWithRetry, jsonResponse, errorResponse } from "./shared/utils.ts";

const YT_ANALYTICS_API = "https://youtubeanalytics.googleapis.com/v2/reports";
const CHANNEL_TOKEN_MAP: Record<string, string> = { "More Mayday": "YOUTUBE_REFRESH_TOKEN_MAYDAY" };

async function getAccessToken(accountName?: string): Promise<string | null> {
  const clientId = Deno.env.get("YOUTUBE_CLIENT_ID");
  const clientSecret = Deno.env.get("YOUTUBE_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;
  const envVar = (accountName && CHANNEL_TOKEN_MAP[accountName]) || "YOUTUBE_REFRESH_TOKEN";
  const refreshToken = Deno.env.get(envVar);
  if (!refreshToken) return null;
  const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }) });
  if (!res.ok) return null;
  const data = await res.json();
  return data.access_token;
}

const BASIC = ["views","estimatedMinutesWatched","averageViewDuration"];
const MIN = ["views","estimatedMinutesWatched"];
const GEO_FULL = ["views","estimatedMinutesWatched","averageViewDuration","averageViewPercentage","subscribersGained","subscribersLost","likes","dislikes","comments","shares"];

const COL_MAP: Record<string,string> = {
  views:"views", estimatedMinutesWatched:"watch_time_minutes",
  averageViewDuration:"average_view_duration_seconds", averageViewPercentage:"average_view_percentage",
  subscribersGained:"subscribers_gained", subscribersLost:"subscribers_lost",
  likes:"likes", dislikes:"dislikes", comments:"comments", shares:"shares",
  viewerPercentage:"viewer_percentage",
};

// `maxRows` cap is per-dim. Top-N "detail" reports (external URLs, search
// terms) cap at 25; others up to 250.
type DimSpec = { table: string; videoTable: string; apiDim: string; apiFilter?: string; metrics: string[]; sort?: string; maxRows?: number };
const DIMENSIONS: Record<string, DimSpec> = {
  traffic_source:      { table:"yt_dim_traffic_source",      videoTable:"yt_video_dim_traffic_source",      apiDim:"insightTrafficSourceType",                                              metrics: BASIC, sort: "-views" },
  external:            { table:"yt_dim_external",            videoTable:"yt_video_dim_external",            apiDim:"insightTrafficSourceDetail", apiFilter:"insightTrafficSourceType==EXT_URL",  metrics: MIN, sort: "-views", maxRows: 25 },
  search_terms:        { table:"yt_dim_search_terms",        videoTable:"yt_video_dim_search_terms",        apiDim:"insightTrafficSourceDetail", apiFilter:"insightTrafficSourceType==YT_SEARCH", metrics: MIN, sort: "-views", maxRows: 25 },
  geography:           { table:"yt_dim_geography",           videoTable:"yt_video_dim_geography",           apiDim:"country",                                                              metrics: GEO_FULL, sort: "-views" },
  city:                { table:"yt_dim_city",                videoTable:"yt_video_dim_city",                apiDim:"city",                                                                 metrics: BASIC, sort: "-views" },
  playback_location:   { table:"yt_dim_playback_location",   videoTable:"yt_video_dim_playback_location",   apiDim:"insightPlaybackLocationType",                                          metrics: BASIC, sort: "-views" },
  device:              { table:"yt_dim_device",              videoTable:"yt_video_dim_device",              apiDim:"deviceType",                                                           metrics: BASIC, sort: "-views" },
  os:                  { table:"yt_dim_os",                  videoTable:"yt_video_dim_os",                  apiDim:"operatingSystem",                                                      metrics: BASIC, sort: "-views" },
  sharing_service:     { table:"yt_dim_sharing_service",     videoTable:"yt_video_dim_sharing_service",     apiDim:"sharingService",                                                       metrics: ["shares"], sort: "-shares" },
  subscription_status: { table:"yt_dim_subscription_status", videoTable:"yt_video_dim_subscription_status", apiDim:"subscribedStatus",                                                     metrics: BASIC },
  viewer_type:         { table:"yt_dim_viewer_type",         videoTable:"yt_video_dim_viewer_type",         apiDim:"youtubeProduct",                                                       metrics: BASIC },
  age:                 { table:"yt_dim_age",                 videoTable:"yt_video_dim_age",                 apiDim:"ageGroup",                                                             metrics: ["viewerPercentage"] },
  gender:              { table:"yt_dim_gender",              videoTable:"yt_video_dim_gender",              apiDim:"gender",                                                               metrics: ["viewerPercentage"] },
};

function mapRow(row: any[], metrics: string[]): Record<string, any> {
  const out: Record<string, any> = { dimension_value: String(row[0] ?? "") };
  for (let i = 0; i < metrics.length; i++) {
    const col = COL_MAP[metrics[i]];
    if (col && out[col] === undefined) out[col] = row[i + 1] ?? 0;
  }
  return out;
}

function dedupeByKey<T extends Record<string, any>>(rows: T[], keyFn: (r: T) => string): T[] {
  const seen = new Map<string, T>();
  for (const r of rows) seen.set(keyFn(r), r);
  return Array.from(seen.values());
}

async function fetchDim(accessToken: string, channelId: string, startDate: string, endDate: string, spec: DimSpec): Promise<{ rows: Array<Record<string, any>>; httpStatus: number; raw?: string }> {
  const max = (spec.maxRows ?? 200).toString();
  const params = new URLSearchParams({ ids: `channel==${channelId}`, startDate, endDate, metrics: spec.metrics.join(","), dimensions: spec.apiDim, maxResults: max });
  if (spec.sort) params.set("sort", spec.sort);
  if (spec.apiFilter) params.set("filters", spec.apiFilter);
  const res = await fetchWithRetry(`${YT_ANALYTICS_API}?${params.toString()}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) { const err = await res.text(); return { rows: [], httpStatus: res.status, raw: err.slice(0, 600) }; }
  const data = await res.json();
  return { rows: (data.rows || []).map((r: any[]) => mapRow(r, spec.metrics)), httpStatus: 200 };
}

async function syncChannelDimensions(supabase: ReturnType<typeof createClient>, accessToken: string, account: any, startDate: string, endDate: string): Promise<Record<string, any>> {
  const out: Record<string, any> = {};
  for (const [key, spec] of Object.entries(DIMENSIONS)) {
    try {
      const { rows, httpStatus, raw } = await fetchDim(accessToken, account.external_id, startDate, endDate, spec);
      if (rows.length > 0) {
        const payload = dedupeByKey(
          rows.map(r => ({ platform_account_id: account.id, date: endDate, ...r, updated_at: new Date().toISOString() })),
          (r) => `${r.platform_account_id}|${r.date}|${r.dimension_value}`,
        );
        const { error } = await supabase.from(spec.table).upsert(payload, { onConflict: "platform_account_id,date,dimension_value" });
        out[key] = error ? { http: httpStatus, rows: payload.length, error: error.message } : { http: httpStatus, rows: payload.length };
      } else {
        out[key] = { http: httpStatus, rows: 0, ...(raw ? { raw } : {}) };
      }
    } catch (e) { out[key] = { error: (e as Error).message }; }
    await new Promise(r => setTimeout(r, 120));
  }
  return out;
}

async function syncVideoDaily(supabase: ReturnType<typeof createClient>, accessToken: string, account: any, startDate: string, endDate: string): Promise<{ count: number; debug: any }> {
  const params = new URLSearchParams({ ids: `channel==${account.external_id}`, startDate, endDate, metrics: GEO_FULL.join(","), dimensions: "video", sort: "-views", maxResults: "200" });
  const res = await fetchWithRetry(`${YT_ANALYTICS_API}?${params.toString()}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return { count: 0, debug: { http: res.status, raw: (await res.text()).slice(0, 400) } };
  const data = await res.json();
  const payload = dedupeByKey((data.rows || []).map((row: any[]) => {
    const m = mapRow(row, GEO_FULL);
    const { dimension_value, ...rest } = m;
    return { platform_account_id: account.id, video_id: dimension_value, date: endDate, ...rest, updated_at: new Date().toISOString() };
  }), (r: any) => `${r.platform_account_id}|${r.date}|${r.video_id}`);
  if (payload.length === 0) return { count: 0, debug: { http: 200, rows: 0 } };
  const { error } = await supabase.from("yt_video_daily").upsert(payload, { onConflict: "platform_account_id,video_id,date" });
  return { count: payload.length, debug: { http: 200, upsert_err: error?.message } };
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
    const url = new URL(req.url);
    const overrideDate = url.searchParams.get("date");
    const includeVideos = url.searchParams.get("videos") !== "0";
    const debug = url.searchParams.get("debug") === "1";
    const targetDate = overrideDate || new Date(Date.now() - 2 * 86400000).toISOString().split("T")[0];
    const accounts = await getActiveAccounts(supabase, "youtube");
    if (accounts.length === 0) return jsonResponse({ message: "No active YouTube accounts" });
    const results: any[] = [];
    for (const account of accounts) {
      const logId = await startIngestionLog(supabase, account.id, "youtube_dimensions_sync");
      try {
        const accessToken = await getAccessToken(account.account_name);
        if (!accessToken) { await failIngestionLog(supabase, logId, "No access token"); results.push({ account: account.account_name, error: "no_access_token" }); continue; }
        const channelDims = await syncChannelDimensions(supabase, accessToken, account, targetDate, targetDate);
        let videoDaily: any = { count: 0 };
        if (includeVideos) videoDaily = await syncVideoDaily(supabase, accessToken, account, targetDate, targetDate);
        const totalRows = Object.values(channelDims).reduce((s: number, v: any) => s + (v?.rows || 0), 0);
        await completeIngestionLog(supabase, logId, { records_processed: totalRows + videoDaily.count });
        results.push({ account: account.account_name, date: targetDate, video_daily_count: videoDaily.count, ...(debug ? { channel_dims: channelDims, video_daily_debug: videoDaily.debug } : { channel_dims_summary: Object.fromEntries(Object.entries(channelDims).map(([k, v]: [string, any]) => [k, v.rows ?? 0])) }) });
      } catch (err) {
        await failIngestionLog(supabase, logId, err as Error);
        results.push({ account: account.account_name, error: (err as Error).message });
      }
    }
    return jsonResponse({ success: true, target_date: targetDate, results });
  } catch (err) {
    console.error("sync-youtube-dimensions fatal:", err);
    return errorResponse((err as Error).message);
  }
});
