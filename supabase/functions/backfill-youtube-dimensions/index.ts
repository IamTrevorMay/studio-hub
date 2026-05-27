import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSupabaseAdmin, getActiveAccounts, fetchWithRetry, jsonResponse, errorResponse } from "./shared/utils.ts";

const YT_API_BASE = "https://www.googleapis.com/youtube/v3";
const YT_ANALYTICS_API = "https://youtubeanalytics.googleapis.com/v2/reports";
const CHANNEL_TOKEN_MAP: Record<string, string> = { "More Mayday": "YOUTUBE_REFRESH_TOKEN_MAYDAY" };

async function getAccessToken(name?: string): Promise<string | null> {
  const cId = Deno.env.get("YOUTUBE_CLIENT_ID");
  const cSec = Deno.env.get("YOUTUBE_CLIENT_SECRET");
  if (!cId || !cSec) return null;
  const env = (name && CHANNEL_TOKEN_MAP[name]) || "YOUTUBE_REFRESH_TOKEN";
  const rt = Deno.env.get(env);
  if (!rt) return null;
  const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: cId, client_secret: cSec, refresh_token: rt, grant_type: "refresh_token" }) });
  if (!res.ok) return null;
  const data = await res.json();
  return data.access_token;
}

const BASIC = ["views","estimatedMinutesWatched","averageViewDuration"];
const MIN = ["views","estimatedMinutesWatched"];

const COL_MAP: Record<string,string> = {
  views:"views", estimatedMinutesWatched:"watch_time_minutes", averageViewDuration:"average_view_duration_seconds",
  averageViewPercentage:"average_view_percentage", subscribersGained:"subscribers_gained", subscribersLost:"subscribers_lost",
  likes:"likes", dislikes:"dislikes", comments:"comments", shares:"shares", viewerPercentage:"viewer_percentage",
};

type DimSpec = { table: string; videoTable?: string; apiDim: string; apiFilter?: string; metrics: string[]; maxRows?: number; mode: 'compound' | 'weekly'; sort?: string };
const DIMENSIONS: Record<string, DimSpec> = {
  traffic_source:      { table:"yt_dim_traffic_source",      videoTable:"yt_video_dim_traffic_source",      apiDim:"insightTrafficSourceType",  metrics: BASIC, mode: 'compound' },
  external:            { table:"yt_dim_external",            apiDim:"insightTrafficSourceDetail", apiFilter:"insightTrafficSourceType==EXT_URL",  metrics: MIN, maxRows: 25, mode: 'weekly', sort: '-views' },
  search_terms:        { table:"yt_dim_search_terms",        apiDim:"insightTrafficSourceDetail", apiFilter:"insightTrafficSourceType==YT_SEARCH", metrics: MIN, maxRows: 25, mode: 'weekly', sort: '-views' },
  geography:           { table:"yt_dim_geography",           apiDim:"country",                   metrics: BASIC, mode: 'weekly', sort: '-views' },
  city:                { table:"yt_dim_city",                apiDim:"city",                      metrics: BASIC, mode: 'weekly', sort: '-views' },
  playback_location:   { table:"yt_dim_playback_location",   apiDim:"insightPlaybackLocationType", metrics: BASIC, mode: 'compound' },
  device:              { table:"yt_dim_device",              apiDim:"deviceType",                metrics: BASIC, mode: 'compound' },
  os:                  { table:"yt_dim_os",                  apiDim:"operatingSystem",           metrics: BASIC, mode: 'compound' },
  sharing_service:     { table:"yt_dim_sharing_service",     apiDim:"sharingService",            metrics: ["shares"], mode: 'weekly', sort: '-shares' },
  subscription_status: { table:"yt_dim_subscription_status", videoTable:"yt_video_dim_subscription_status", apiDim:"subscribedStatus",          metrics: BASIC, mode: 'compound' },
  viewer_type:         { table:"yt_dim_viewer_type",         apiDim:"youtubeProduct",            metrics: BASIC, mode: 'compound' },
  age:                 { table:"yt_dim_age",                 apiDim:"ageGroup",                  metrics: ["viewerPercentage"], mode: 'weekly' },
  gender:              { table:"yt_dim_gender",              apiDim:"gender",                    metrics: ["viewerPercentage"], mode: 'weekly' },
};

// Per-video lifetime aggregate dims (used by Content Health). One API call
// per (video, dim) returns lifetime totals per dimension_value. Cheap.
const VIDEO_DIMENSIONS: Record<string, { table: string; apiDim: string; apiFilter?: string; metrics: string[]; sort?: string; maxRows?: number }> = {
  subscription_status: { table: "yt_video_dim_subscription_status", apiDim: "subscribedStatus",         metrics: BASIC },
  traffic_source:      { table: "yt_video_dim_traffic_source",      apiDim: "insightTrafficSourceType", metrics: BASIC, sort: "-views" },
};

function mapCompoundRow(row: any[], metrics: string[]) {
  const out: Record<string, any> = { date: String(row[0]), dimension_value: String(row[1] ?? "") };
  for (let i = 0; i < metrics.length; i++) { const col = COL_MAP[metrics[i]]; if (col && out[col] === undefined) out[col] = row[2 + i] ?? 0; }
  return out;
}
function mapWeeklyRow(row: any[], metrics: string[], weekEnd: string) {
  const out: Record<string, any> = { date: weekEnd, dimension_value: String(row[0] ?? "") };
  for (let i = 0; i < metrics.length; i++) { const col = COL_MAP[metrics[i]]; if (col && out[col] === undefined) out[col] = row[i + 1] ?? 0; }
  return out;
}

function dedupeByKey<T extends Record<string, any>>(rows: T[], keyFn: (r: T) => string): T[] {
  const seen = new Map<string, T>(); for (const r of rows) seen.set(keyFn(r), r); return Array.from(seen.values());
}

async function fetchChunk(accessToken: string, channelId: string, start: string, end: string, spec: DimSpec): Promise<{ rows: Array<Record<string, any>>; httpStatus: number; raw?: string }> {
  const max = (spec.maxRows ?? 200).toString();
  const dims = spec.mode === 'compound' ? `day,${spec.apiDim}` : spec.apiDim;
  const sort = spec.mode === 'compound' ? 'day' : (spec.sort || '');
  const params = new URLSearchParams({ ids: `channel==${channelId}`, startDate: start, endDate: end, metrics: spec.metrics.join(","), dimensions: dims, maxResults: max });
  if (sort) params.set("sort", sort);
  if (spec.apiFilter) params.set("filters", spec.apiFilter);
  const res = await fetchWithRetry(`${YT_ANALYTICS_API}?${params.toString()}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) { return { rows: [], httpStatus: res.status, raw: (await res.text()).slice(0, 400) }; }
  const data = await res.json();
  const rawRows = data.rows || [];
  const rows = spec.mode === 'compound'
    ? rawRows.map((r: any[]) => mapCompoundRow(r, spec.metrics))
    : rawRows.map((r: any[]) => mapWeeklyRow(r, spec.metrics, end));
  return { rows, httpStatus: 200 };
}

function nextWeekEnd(d: Date): Date { const n = new Date(d); n.setDate(n.getDate() + 6); return n; }
function nextMonthEnd(d: Date): Date { const n = new Date(d); n.setMonth(n.getMonth() + 1); n.setDate(0); return n; }

async function backfillChannelDim(supabase: ReturnType<typeof createClient>, accessToken: string, account: any, spec: DimSpec, dimKey: string, startDate: string, endDate: string): Promise<{ rows: number; chunks: number; sample_err?: string }> {
  const { data: progArr } = await supabase.from("yt_backfill_progress").select("id, last_completed_through").eq("platform_account_id", account.id).eq("scope", "channel").eq("dimension", dimKey).is("video_id", null).order("last_completed_through", { ascending: false, nullsFirst: false }).limit(1);
  const prog = progArr && progArr[0];
  let cursor = prog?.last_completed_through ? new Date(new Date(prog.last_completed_through).getTime() + 86400000) : new Date(startDate);
  const end = new Date(endDate);
  let totalRows = 0, chunks = 0, sampleErr: string | undefined;
  if (prog) { await supabase.from("yt_backfill_progress").update({ status: "running", updated_at: new Date().toISOString() }).eq("id", prog.id); }
  else { await supabase.from("yt_backfill_progress").insert({ platform_account_id: account.id, scope: "channel", dimension: dimKey, video_id: null, status: "running", updated_at: new Date().toISOString() }); }
  while (cursor <= end) {
    const chunkEnd = nextWeekEnd(cursor) > end ? end : nextWeekEnd(cursor);
    const sStr = cursor.toISOString().split("T")[0];
    const eStr = chunkEnd.toISOString().split("T")[0];
    try {
      const { rows, httpStatus, raw } = await fetchChunk(accessToken, account.external_id, sStr, eStr, spec);
      if (rows.length > 0) {
        const payload = dedupeByKey(
          rows.map(r => ({ platform_account_id: account.id, ...r, updated_at: new Date().toISOString() })),
          (r) => `${r.platform_account_id}|${r.date}|${r.dimension_value}`,
        );
        const { error } = await supabase.from(spec.table).upsert(payload, { onConflict: "platform_account_id,date,dimension_value" });
        if (error) console.error(`Upsert ${spec.table} ${sStr}: ${error.message}`);
        totalRows += payload.length;
      } else if (httpStatus !== 200 && !sampleErr) { sampleErr = `${httpStatus}: ${raw}`; }
      chunks++;
      await supabase.from("yt_backfill_progress").update({ last_completed_through: eStr, updated_at: new Date().toISOString() }).eq("platform_account_id", account.id).eq("scope", "channel").eq("dimension", dimKey).is("video_id", null);
    } catch (e) { console.error(`Chunk failed ${dimKey} ${sStr}:`, e); break; }
    cursor = new Date(chunkEnd.getTime() + 86400000);
    await new Promise(r => setTimeout(r, 120));
  }
  await supabase.from("yt_backfill_progress").update({ status: cursor > end ? "complete" : "running", updated_at: new Date().toISOString() }).eq("platform_account_id", account.id).eq("scope", "channel").eq("dimension", dimKey).is("video_id", null);
  return { rows: totalRows, chunks, ...(sampleErr ? { sample_err: sampleErr } : {}) };
}

async function backfillVideoDaily(supabase: ReturnType<typeof createClient>, accessToken: string, account: any, startDate: string, endDate: string): Promise<{ rows: number; chunks: number; sample_err?: string }> {
  const dimKey = "video_daily";
  const { data: progArr } = await supabase.from("yt_backfill_progress").select("id, last_completed_through").eq("platform_account_id", account.id).eq("scope", "channel").eq("dimension", dimKey).is("video_id", null).order("last_completed_through", { ascending: false, nullsFirst: false }).limit(1);
  const prog = progArr && progArr[0];
  let cursor = prog?.last_completed_through ? new Date(new Date(prog.last_completed_through).getTime() + 86400000) : new Date(startDate);
  const end = new Date(endDate);
  let totalRows = 0, chunks = 0, sampleErr: string | undefined;
  if (prog) { await supabase.from("yt_backfill_progress").update({ status: "running", updated_at: new Date().toISOString() }).eq("id", prog.id); }
  else { await supabase.from("yt_backfill_progress").insert({ platform_account_id: account.id, scope: "channel", dimension: dimKey, video_id: null, status: "running", updated_at: new Date().toISOString() }); }
  while (cursor <= end) {
    const chunkEnd = nextMonthEnd(cursor) > end ? end : nextMonthEnd(cursor);
    const sStr = cursor.toISOString().split("T")[0];
    const eStr = chunkEnd.toISOString().split("T")[0];
    try {
      const params = new URLSearchParams({ ids: `channel==${account.external_id}`, startDate: sStr, endDate: eStr, metrics: BASIC.join(","), dimensions: "video", sort: "-views", maxResults: "200" });
      const res = await fetchWithRetry(`${YT_ANALYTICS_API}?${params.toString()}`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (res.ok) {
        const data = await res.json();
        const payload = dedupeByKey((data.rows || []).map((r: any[]) => {
          const out: Record<string, any> = { platform_account_id: account.id, date: eStr, video_id: String(r[0]), updated_at: new Date().toISOString() };
          for (let i = 0; i < BASIC.length; i++) { const col = COL_MAP[BASIC[i]]; if (col) out[col] = r[1 + i] ?? 0; }
          return out;
        }), (r: any) => `${r.platform_account_id}|${r.date}|${r.video_id}`);
        if (payload.length > 0) {
          const { error } = await supabase.from("yt_video_daily").upsert(payload, { onConflict: "platform_account_id,video_id,date" });
          if (error) console.error(`yt_video_daily upsert ${sStr}: ${error.message}`);
          totalRows += payload.length;
        }
      } else { const txt = (await res.text()).slice(0, 300); if (!sampleErr) sampleErr = `${res.status}: ${txt}`; console.error(`yt_video_daily chunk ${sStr}: ${res.status} ${txt}`); }
      chunks++;
      await supabase.from("yt_backfill_progress").update({ last_completed_through: eStr, updated_at: new Date().toISOString() }).eq("platform_account_id", account.id).eq("scope", "channel").eq("dimension", dimKey).is("video_id", null);
    } catch (e) { console.error(`video_daily chunk failed ${sStr}:`, e); }
    cursor = new Date(chunkEnd.getTime() + 86400000);
    await new Promise(r => setTimeout(r, 120));
  }
  await supabase.from("yt_backfill_progress").update({ status: cursor > end ? "complete" : "running", updated_at: new Date().toISOString() }).eq("platform_account_id", account.id).eq("scope", "channel").eq("dimension", dimKey).is("video_id", null);
  return { rows: totalRows, chunks, ...(sampleErr ? { sample_err: sampleErr } : {}) };
}

// Per-video lifetime aggregate fetch. Single API call returns per-dim-value
// totals for the video over its lifetime.
async function backfillOneVideoDim(supabase: ReturnType<typeof createClient>, accessToken: string, account: any, videoId: string, dimKey: string): Promise<{ rows: number; ok: boolean }> {
  const spec = VIDEO_DIMENSIONS[dimKey]; if (!spec) return { rows: 0, ok: false };
  const startDate = "2010-01-01";
  const endDate = new Date(Date.now() - 2 * 86400000).toISOString().split("T")[0];
  const filter = spec.apiFilter ? `${spec.apiFilter};video==${videoId}` : `video==${videoId}`;
  const params = new URLSearchParams({ ids: `channel==${account.external_id}`, startDate, endDate, metrics: spec.metrics.join(","), dimensions: spec.apiDim, maxResults: (spec.maxRows ?? 200).toString(), filters: filter });
  if (spec.sort) params.set("sort", spec.sort);
  const res = await fetchWithRetry(`${YT_ANALYTICS_API}?${params.toString()}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) { console.error(`video dim ${dimKey} ${videoId}: ${res.status} ${(await res.text()).slice(0,200)}`); return { rows: 0, ok: false }; }
  const data = await res.json();
  if (!data.rows || data.rows.length === 0) return { rows: 0, ok: true };
  const payload = dedupeByKey((data.rows as any[]).map((r: any[]) => {
    const out: Record<string, any> = { platform_account_id: account.id, video_id: videoId, date: endDate, dimension_value: String(r[0] ?? ""), updated_at: new Date().toISOString() };
    for (let i = 0; i < spec.metrics.length; i++) { const col = COL_MAP[spec.metrics[i]]; if (col) out[col] = r[i + 1] ?? 0; }
    return out;
  }), (r: any) => `${r.platform_account_id}|${r.video_id}|${r.dimension_value}`);
  const { error } = await supabase.from(spec.table).upsert(payload, { onConflict: "platform_account_id,video_id,date,dimension_value" });
  if (error) console.error(`upsert ${spec.table} ${videoId}: ${error.message}`);
  return { rows: payload.length, ok: true };
}

async function backfillVideoDimsForAccount(supabase: ReturnType<typeof createClient>, accessToken: string, account: any, maxOps: number): Promise<{ ops: number; rows: number }> {
  // Paginate through yt_video_daily to collect ALL distinct video_ids — the
  // default Supabase 1000-row cap would otherwise miss long-tail videos.
  const videoIds: string[] = [];
  const seen = new Set<string>();
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data: page } = await supabase.from("yt_video_daily").select("video_id").eq("platform_account_id", account.id).order("video_id").range(from, from + PAGE - 1);
    if (!page || page.length === 0) break;
    for (const r of page) { if (!seen.has(r.video_id)) { seen.add(r.video_id); videoIds.push(r.video_id); } }
    if (page.length < PAGE) break;
    from += PAGE;
  }
  let ops = 0, rows = 0;
  for (const videoId of videoIds) {
    for (const dimKey of Object.keys(VIDEO_DIMENSIONS)) {
      if (ops >= maxOps) return { ops, rows };
      const { data: prog } = await supabase.from("yt_backfill_progress").select("id, status").eq("platform_account_id", account.id).eq("scope", "video").eq("dimension", dimKey).eq("video_id", videoId).maybeSingle();
      if (prog && prog.status === "complete") continue;
      const r = await backfillOneVideoDim(supabase, accessToken, account, videoId, dimKey);
      rows += r.rows;
      ops++;
      if (prog) await supabase.from("yt_backfill_progress").update({ status: r.ok ? "complete" : "failed", updated_at: new Date().toISOString() }).eq("id", prog.id);
      else await supabase.from("yt_backfill_progress").insert({ platform_account_id: account.id, scope: "video", dimension: dimKey, video_id: videoId, status: r.ok ? "complete" : "failed", updated_at: new Date().toISOString() });
      await new Promise(res => setTimeout(res, 120));
    }
  }
  return { ops, rows };
}

async function getChannelStart(accessToken: string, channelId: string): Promise<string> {
  const apiKey = Deno.env.get("YOUTUBE_API_KEY");
  if (!apiKey) return "2015-01-01";
  const res = await fetchWithRetry(`${YT_API_BASE}/channels?part=snippet&id=${channelId}&key=${apiKey}`);
  const data = await res.json();
  const pub = data.items?.[0]?.snippet?.publishedAt;
  return pub ? new Date(pub).toISOString().split("T")[0] : "2015-01-01";
}

serve(async (req) => {
  try {
    const supabase = getSupabaseAdmin();
    const url = new URL(req.url);
    const target = url.searchParams.get("account");
    const dry = url.searchParams.get("dry") === "1";
    const reset = url.searchParams.get("reset") === "1";
    const resetPartial = url.searchParams.get("reset_partial") === "1";
    const resetVideo = url.searchParams.get("reset_video") === "1";
    const onlyDim = url.searchParams.get("dimension");
    const maxChunks = parseInt(url.searchParams.get("max_chunks") || "120");
    const scope = url.searchParams.get("scope");
    const maxOps = parseInt(url.searchParams.get("max_ops") || "800");
    const testChunk = url.searchParams.get("test_chunk");
    const testStart = url.searchParams.get("test_start");
    const testEnd = url.searchParams.get("test_end");

    let accounts = await getActiveAccounts(supabase, "youtube");
    if (target) accounts = accounts.filter((a: any) => a.account_name.toLowerCase().includes(target.toLowerCase()));
    if (accounts.length === 0) return jsonResponse({ message: "No matching accounts" });

    if (testChunk && testStart && testEnd) {
      const spec = DIMENSIONS[testChunk]; if (!spec) return jsonResponse({ error: `Unknown dim ${testChunk}` });
      const results: any[] = [];
      for (const a of accounts) {
        const token = await getAccessToken(a.account_name); if (!token) { results.push({ account: a.account_name, error: 'no_token' }); continue; }
        const r = await fetchChunk(token, a.external_id, testStart, testEnd, spec);
        results.push({ account: a.account_name, http: r.httpStatus, rows: r.rows.length, sample: r.rows.slice(0, 3), raw: r.raw });
      }
      return jsonResponse({ test: testChunk, start: testStart, end: testEnd, results });
    }

    if (reset) { for (const a of accounts) await supabase.from("yt_backfill_progress").delete().eq("platform_account_id", a.id); return jsonResponse({ reset: true, accounts: accounts.map((a:any)=>a.account_name) }); }
    if (resetPartial) { const partial = ['geography','city','age','gender','sharing_service','external','search_terms','video_daily']; for (const a of accounts) await supabase.from("yt_backfill_progress").delete().eq("platform_account_id", a.id).in("dimension", partial); return jsonResponse({ reset_partial: partial, accounts: accounts.map((a:any)=>a.account_name) }); }
    if (resetVideo) { for (const a of accounts) await supabase.from("yt_backfill_progress").delete().eq("platform_account_id", a.id).eq("scope", "video"); return jsonResponse({ reset_video: true, accounts: accounts.map((a:any)=>a.account_name) }); }

    if (scope === "video") {
      const results: any[] = [];
      let opsUsed = 0;
      for (const account of accounts) {
        const accessToken = await getAccessToken(account.account_name);
        if (!accessToken) { results.push({ account: account.account_name, error: "no_access_token" }); continue; }
        const remaining = maxOps - opsUsed;
        if (remaining <= 0) { results.push({ account: account.account_name, halted: "max_ops" }); break; }
        const r = await backfillVideoDimsForAccount(supabase, accessToken, account, remaining);
        opsUsed += r.ops;
        results.push({ account: account.account_name, ops: r.ops, rows: r.rows, halted: r.ops >= remaining ? "max_ops" : undefined });
      }
      return jsonResponse({ success: true, scope: "video", ops_used: opsUsed, results });
    }

    const results: any[] = [];
    let chunksUsed = 0;
    for (const account of accounts) {
      const accessToken = await getAccessToken(account.account_name);
      if (!accessToken) { results.push({ account: account.account_name, error: "no_access_token" }); continue; }
      const startDate = await getChannelStart(accessToken, account.external_id);
      const endDate = new Date(Date.now() - 2 * 86400000).toISOString().split("T")[0];
      const accountResult: any = { account: account.account_name, start: startDate, end: endDate, dims: {} };
      if (dry) { const dimKeys = onlyDim ? [onlyDim] : Object.keys(DIMENSIONS); accountResult.dry = true; accountResult.dimensions_planned = dimKeys; results.push(accountResult); continue; }
      if (!onlyDim || onlyDim === "video_daily") {
        if (chunksUsed >= maxChunks) { accountResult.halted = "max_chunks"; results.push(accountResult); break; }
        const r = await backfillVideoDaily(supabase, accessToken, account, startDate, endDate);
        accountResult.dims["video_daily"] = r;
        chunksUsed += r.chunks;
      }
      const dimKeys = onlyDim ? [onlyDim] : Object.keys(DIMENSIONS);
      for (const k of dimKeys) {
        if (!DIMENSIONS[k]) continue;
        if (chunksUsed >= maxChunks) { accountResult.halted = "max_chunks"; break; }
        const r = await backfillChannelDim(supabase, accessToken, account, DIMENSIONS[k], k, startDate, endDate);
        accountResult.dims[k] = r;
        chunksUsed += r.chunks;
      }
      results.push(accountResult);
    }
    return jsonResponse({ success: true, chunks_used: chunksUsed, results });
  } catch (err) {
    console.error("backfill-youtube-dimensions fatal:", err);
    return errorResponse((err as Error).message);
  }
});
