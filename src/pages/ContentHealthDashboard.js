// Content Health dashboard — Stability vs Growth scoring for YT videos.
//
// Framework: each video gets a Stability score (deepening loyal audience)
// and a Growth score (expanding reach), each 0-100 normalized against the
// channel's trailing-20-video median. Breakout = (Stability × Growth)/100
// + a "purity check" on new:returning ratio.
//
// Data sources:
//   yt_video_daily                       — lifetime totals per video
//   yt_video_dim_subscription_status     — per-video SUBSCRIBED vs UNSUBSCRIBED
//   yt_video_dim_traffic_source          — per-video traffic source breakdown
//   content_items                        — title, thumbnail, published_at, url
//
// Proxy notes (YT v2 API doesn't expose):
//   "returning viewer"        → subscribedStatus=SUBSCRIBED views
//   "new viewer"              → subscribedStatus=UNSUBSCRIBED views
//   "subscriber CTR"          → not available; dropped from scoring
//   "non-subscriber CTR"      → not available; dropped from scoring
//   "new viewer retention"    → using avg_view_duration from non-sub views
//   "7-day repeat viewership" → not available; dropped from scoring

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '../supabaseClient';
import backdropDismiss from '../lib/backdropDismiss';
import { colors } from '../lib/styleTokens';
import { Sparkline, Skeleton } from './analytics/viz';

// ═══════════════════════════════════════════════════════════════════
// Scoring config
// ═══════════════════════════════════════════════════════════════════
const NORM_WINDOW = 20; // trailing N videos for self-referential norm
const BREAKOUT_GATE = { stability: 60, growth: 60, ratio_tolerance: 0.25 };

// Index = 100 means "double the channel median". Linear scaling.
// median * 1 → 50, median * 2 → 100, median * 0 → 0.
function computeIndex(value, median) {
  if (!median || median === 0) return value > 0 ? 100 : 0;
  return Math.max(0, Math.min(100, (value / median) * 50));
}

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Per-channel-ROLE weight sets so the scatter + ranked table reflect each
// channel's real priorities. BROAD (More Mayday) growth leans suggested-reach
// (algo_traffic_pct) + subs conversion; NICHE (Trevor May Baseball) growth leans
// subs-per-video (new_sub_conversion) + volume, and relies less on the suggested
// feed. Stability: niche weights returning-viewer strength harder; broad is more
// engagement-forward. Each set sums to 1.0. Tunable — these are informed defaults.
const STABILITY_WEIGHTS_BY_ROLE = {
  broad: { returning_watch_time: 0.28, engagement_rate: 0.27, sub_conversion: 0.15, returning_view_pct: 0.15, avg_view_duration: 0.15 },
  niche: { returning_watch_time: 0.32, engagement_rate: 0.18, sub_conversion: 0.15, returning_view_pct: 0.22, avg_view_duration: 0.13 },
};
const GROWTH_WEIGHTS_BY_ROLE = {
  broad: { new_viewer_volume: 0.28, new_viewer_pct: 0.17, new_sub_conversion: 0.17, new_viewer_retention: 0.10, algo_traffic_pct: 0.28 },
  niche: { new_viewer_volume: 0.30, new_viewer_pct: 0.15, new_sub_conversion: 0.28, new_viewer_retention: 0.15, algo_traffic_pct: 0.12 },
};
function weightsForRole(role) {
  return {
    stability: STABILITY_WEIGHTS_BY_ROLE[role] || STABILITY_WEIGHTS_BY_ROLE.broad,
    growth: GROWTH_WEIGHTS_BY_ROLE[role] || GROWTH_WEIGHTS_BY_ROLE.broad,
  };
}

// Channel role + CSV-channel-key resolution, keyed by YouTube external_id
// (falls back to account_name matching). BROAD = wide-reach flagship, NICHE =
// intent/search-driven vertical. CSV key maps to analytics_youtube.channel.
const CHANNEL_ROLE_BY_EXT = { UCwM4xXRFO5bORhM4XCEquXg: 'broad', UCXnWH_cIChvXGhLPIJGoiBg: 'niche' };
const CSV_CHANNEL_BY_EXT = { UCwM4xXRFO5bORhM4XCEquXg: 'moremayday', UCXnWH_cIChvXGhLPIJGoiBg: 'trevormay' };
function roleForAccount(acct) {
  if (!acct) return 'broad';
  if (acct.external_id && CHANNEL_ROLE_BY_EXT[acct.external_id]) return CHANNEL_ROLE_BY_EXT[acct.external_id];
  const n = (acct.account_name || '').toLowerCase();
  if (n.includes('baseball') || n.includes('trevor may')) return 'niche';
  return 'broad';
}

// KPI section config: trailing-window channel-level KPIs. Window is short (14d)
// because the channel-dim daily series only goes back ~33 days; current window vs
// the prior equal window drives the delta.
const KPI_WINDOW = 14;
// Traffic-source dimension_value codes (verified against yt_dim_traffic_source).
const TRAFFIC = { search: 'YT_SEARCH', suggested: 'RELATED_VIDEO', browse: 'YT_OTHER_PAGE', playlist: 'PLAYLIST', endScreen: 'END_SCREEN' };

const CATEGORY_COLORS = {
  breakout:        '#f59e0b',
  stability:       '#5b8fc7',
  growth:          '#22c55e',
  underperforming: '#64748b',
};

// NOTE: never returns 'breakout' — that label is owned solely by the is_breakout
// flag (which also enforces the purity check). A video can clear both score
// gates yet fail purity; it must land in stability/growth, not breakout.
function categorize(s, g) {
  if (s >= g && s >= 50) return 'stability';
  if (g > s && g >= 50) return 'growth';
  return 'underperforming';
}

// Long-form scoring — the original Stability × Growth model, extracted so it can
// run over a format-scoped cohort. `list` must be pre-sorted newest→oldest.
function scoreLongForm(list, SW, GW) {
  return list.map((v, idx) => {
    const trailing = list.slice(idx + 1, idx + 1 + NORM_WINDOW);
    const meds = {
      returning_watch_time: median(trailing.map(t => t.returning_watch_time)),
      engagement_rate:      median(trailing.map(t => t.engagement_rate)),
      sub_conversion:       median(trailing.map(t => t.sub_conversion)),
      returning_view_pct:   median(trailing.map(t => t.returning_view_pct)),
      avg_view_duration:    median(trailing.map(t => t.avg_view_duration_seconds)),
      new_viewer_volume:    median(trailing.map(t => t.new_viewer_volume)),
      new_viewer_pct:       median(trailing.map(t => t.new_viewer_pct)),
      new_sub_conversion:   median(trailing.map(t => t.new_sub_conversion)),
      new_viewer_retention: median(trailing.map(t => t.new_viewer_retention)),
      algo_traffic_pct:     median(trailing.map(t => t.algo_traffic_pct)),
      new_to_returning_ratio: median(
        trailing.filter(t => t.returning_view_pct > 0).map(t => t.new_viewer_volume / Math.max(t.returning_watch_time / 60, 1)),
      ),
    };
    const idx_returning_wt = computeIndex(v.returning_watch_time, meds.returning_watch_time);
    const idx_engagement   = computeIndex(v.engagement_rate,      meds.engagement_rate);
    const idx_sub_conv     = computeIndex(v.sub_conversion,       meds.sub_conversion);
    const idx_returning_pct = computeIndex(v.returning_view_pct,  meds.returning_view_pct);
    const idx_avd          = computeIndex(v.avg_view_duration_seconds, meds.avg_view_duration);
    const stability = (
      idx_returning_wt    * SW.returning_watch_time +
      idx_engagement      * SW.engagement_rate +
      idx_sub_conv        * SW.sub_conversion +
      idx_returning_pct   * SW.returning_view_pct +
      idx_avd             * SW.avg_view_duration
    );
    const idx_new_vol      = computeIndex(v.new_viewer_volume,      meds.new_viewer_volume);
    const idx_new_pct      = computeIndex(v.new_viewer_pct,         meds.new_viewer_pct);
    const idx_new_sub_conv = computeIndex(v.new_sub_conversion,     meds.new_sub_conversion);
    const idx_new_ret      = computeIndex(v.new_viewer_retention,   meds.new_viewer_retention);
    const idx_algo         = computeIndex(v.algo_traffic_pct,       meds.algo_traffic_pct);
    const growth = (
      idx_new_vol      * GW.new_viewer_volume +
      idx_new_pct      * GW.new_viewer_pct +
      idx_new_sub_conv * GW.new_sub_conversion +
      idx_new_ret      * GW.new_viewer_retention +
      idx_algo         * GW.algo_traffic_pct
    );
    const breakoutRaw = (stability * growth) / 100;
    const channelRatio = meds.new_to_returning_ratio || 0;
    const videoRatio = v.new_viewer_volume / Math.max(v.returning_watch_time / 60, 1);
    const ratioDelta = channelRatio > 0 ? Math.abs(videoRatio - channelRatio) / channelRatio : 0;
    const isBreakout = stability >= BREAKOUT_GATE.stability && growth >= BREAKOUT_GATE.growth && ratioDelta <= BREAKOUT_GATE.ratio_tolerance;
    return {
      ...v,
      stability_score: stability, growth_score: growth, breakout_raw: breakoutRaw,
      is_breakout: isBreakout, category: isBreakout ? 'breakout' : categorize(stability, growth),
      ratio_delta: ratioDelta,
      indices: {
        stability: { returning_watch_time: idx_returning_wt, engagement_rate: idx_engagement, sub_conversion: idx_sub_conv, returning_view_pct: idx_returning_pct, avg_view_duration: idx_avd },
        growth: { new_viewer_volume: idx_new_vol, new_viewer_pct: idx_new_pct, new_sub_conversion: idx_new_sub_conv, new_viewer_retention: idx_new_ret, algo_traffic_pct: idx_algo },
      },
      trailing_sample_size: trailing.length,
    };
  });
}

// Short-form scoring — a Retention (x) × Spread (y) plane, a 2-axis reduction of
// Ashley's four families that plugs into the same scatter/table/detail:
//   Retention (stability-analog) = completion % + avg watch  (Hold family)
//   Spread    (growth-analog)    = shares/view + follows/1k  (Amplify + Convert)
// Hook (scroll-stop) and saves/view are excluded — neither exists in per-video
// data (no swipe-away metric; content_metrics.saves is uniformly 0). Normalized
// against a SHORTS-ONLY trailing cohort. `list` pre-sorted newest→oldest.
const SHORT_WEIGHTS_BY_ROLE = {
  broad: { retention: { completion: 0.75, avg_watch: 0.25 }, spread: { shares_per_view: 0.60, follows_per_1k: 0.40 } },
  niche: { retention: { completion: 0.75, avg_watch: 0.25 }, spread: { shares_per_view: 0.35, follows_per_1k: 0.65 } },
};
function shortsDisplayWeights(role) {
  const W = SHORT_WEIGHTS_BY_ROLE[role] || SHORT_WEIGHTS_BY_ROLE.broad;
  return {
    stability: { completion_pct: W.retention.completion, avg_view_duration: W.retention.avg_watch },
    growth: { shares_per_view: W.spread.shares_per_view, follows_per_1k: W.spread.follows_per_1k },
  };
}
function scoreShortForm(list, W) {
  return list.map((v, idx) => {
    const trailing = list.slice(idx + 1, idx + 1 + NORM_WINDOW);
    const meds = {
      completion_pct:    median(trailing.map(t => t.completion_pct)),
      avg_view_duration: median(trailing.map(t => t.avg_view_duration_seconds)),
      shares_per_view:   median(trailing.map(t => t.shares_per_view)),
      follows_per_1k:    median(trailing.map(t => t.follows_per_1k)),
    };
    const idx_completion = computeIndex(v.completion_pct, meds.completion_pct);
    const idx_avd        = computeIndex(v.avg_view_duration_seconds, meds.avg_view_duration);
    const idx_shares     = computeIndex(v.shares_per_view, meds.shares_per_view);
    const idx_follows    = computeIndex(v.follows_per_1k, meds.follows_per_1k);
    const retention = idx_completion * W.retention.completion + idx_avd * W.retention.avg_watch;
    const spread    = idx_shares * W.spread.shares_per_view + idx_follows * W.spread.follows_per_1k;
    const breakoutRaw = (retention * spread) / 100;
    const isBreakout = retention >= BREAKOUT_GATE.stability && spread >= BREAKOUT_GATE.growth;
    return {
      ...v,
      stability_score: retention, growth_score: spread, breakout_raw: breakoutRaw,
      is_breakout: isBreakout, category: isBreakout ? 'breakout' : categorize(retention, spread),
      ratio_delta: 0,
      indices: {
        stability: { completion_pct: idx_completion, avg_view_duration: idx_avd },
        growth: { shares_per_view: idx_shares, follows_per_1k: idx_follows },
      },
      trailing_sample_size: trailing.length,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════
// Per-channel column — fetches + scores ONE YouTube channel and renders its
// Growth/Stability (long-form) or Shorts family scorecard (short-form), plus a
// collapsible per-video drill-down. Two of these render side by side per tab.
// ═══════════════════════════════════════════════════════════════════
function ChannelColumn({ account, view }) {
  const activeChannelId = account.id;             // body is scoped to this id
  const activeRole = roleForAccount(account);
  const [videosLong, setVideosLong] = useState([]);
  const [videosShort, setVideosShort] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedVideoId, setSelectedVideoId] = useState(null);
  const [drillOpen, setDrillOpen] = useState(false);
  const fetchGenRef = useRef(0); // guards against a stale fetch resolving last

  const [kpis, setKpis] = useState(null);           // channel-wide context (traffic, terms)
  const [kpisLoading, setKpisLoading] = useState(false);
  const kpiGenRef = useRef(0);
  const [formatKpis, setFormatKpis] = useState(null); // per-format splittable KPI tiles { long, short }
  const formatGenRef = useRef(0);

  useEffect(() => {
    fetchAndScore();
    fetchChannelKpis();
    fetchFormatKpis();
    // eslint-disable-next-line
  }, [account.id]);

  async function fetchAndScore() {
    const gen = ++fetchGenRef.current;
    const role = activeRole;
    const { stability: SW, growth: GW } = weightsForRole(role);
    setLoading(true);
    try {
      // Lifetime aggregate per video from yt_video_daily
      const { data: dailyRows } = await supabase
        .from('yt_video_daily')
        .select('video_id, views, watch_time_minutes, average_view_duration_seconds, average_view_percentage, subscribers_gained, likes, comments, shares')
        .eq('platform_account_id', activeChannelId)
        .limit(50000);

      // Per-video sub_status aggregate
      const { data: subRows } = await supabase
        .from('yt_video_dim_subscription_status')
        .select('video_id, dimension_value, views, watch_time_minutes, average_view_duration_seconds')
        .eq('platform_account_id', activeChannelId)
        .limit(50000);

      // Per-video traffic source aggregate (for algo signal)
      const { data: trafficRows } = await supabase
        .from('yt_video_dim_traffic_source')
        .select('video_id, dimension_value, views')
        .eq('platform_account_id', activeChannelId)
        .limit(50000);

      // Aggregate yt_video_daily across all dates per video
      const dailyByVideo = {};
      for (const r of (dailyRows || [])) {
        const id = r.video_id;
        if (!dailyByVideo[id]) dailyByVideo[id] = { views: 0, watch_time_minutes: 0, avd_sum: 0, avd_n: 0, apv_sum: 0, apv_n: 0, subs: 0, likes: 0, comments: 0, shares: 0 };
        const d = dailyByVideo[id];
        d.views += Number(r.views) || 0;
        d.watch_time_minutes += Number(r.watch_time_minutes) || 0;
        d.subs += Number(r.subscribers_gained) || 0;
        d.likes += Number(r.likes) || 0;
        d.comments += Number(r.comments) || 0;
        d.shares += Number(r.shares) || 0;
        // weighted avg view duration + avg percentage viewed, by views
        const avd = Number(r.average_view_duration_seconds) || 0;
        const apv = Number(r.average_view_percentage) || 0;
        const v = Number(r.views) || 0;
        d.avd_sum += avd * v; d.avd_n += v;
        d.apv_sum += apv * v; d.apv_n += v;
      }

      // Aggregate sub_status per video
      const subByVideo = {};
      for (const r of (subRows || [])) {
        const id = r.video_id;
        if (!subByVideo[id]) subByVideo[id] = { sub_views: 0, unsub_views: 0, sub_watch: 0, unsub_watch: 0, sub_avd_sum: 0, sub_avd_n: 0, unsub_avd_sum: 0, unsub_avd_n: 0 };
        const isSub = String(r.dimension_value).toUpperCase() === 'SUBSCRIBED';
        const v = Number(r.views) || 0;
        const wt = Number(r.watch_time_minutes) || 0;
        const avd = Number(r.average_view_duration_seconds) || 0;
        if (isSub) {
          subByVideo[id].sub_views += v;
          subByVideo[id].sub_watch += wt;
          subByVideo[id].sub_avd_sum += avd * v;
          subByVideo[id].sub_avd_n += v;
        } else {
          subByVideo[id].unsub_views += v;
          subByVideo[id].unsub_watch += wt;
          subByVideo[id].unsub_avd_sum += avd * v;
          subByVideo[id].unsub_avd_n += v;
        }
      }

      // Aggregate traffic source: algo % = algorithmic-discovery surfaces / total.
      // These are the dimension_value codes YouTube actually returns (verified
      // against yt_video_dim_traffic_source): RELATED_VIDEO = suggested feed,
      // SHORTS = Shorts feed, YT_OTHER_PAGE = browse/other. (The old set used
      // 'SUGGESTED'/'BROWSE', which never exist in the data, so algo % was
      // capturing ~2% of true algo traffic instead of ~50%.) Search, channel
      // page, subscriptions and notifications are intentionally excluded — those
      // are intent/owned surfaces, not algorithmic discovery.
      const ALGO_SOURCES = new Set(['RELATED_VIDEO','YT_OTHER_PAGE','SHORTS']);
      const trafficByVideo = {};
      for (const r of (trafficRows || [])) {
        const id = r.video_id;
        if (!trafficByVideo[id]) trafficByVideo[id] = { total: 0, algo: 0 };
        const v = Number(r.views) || 0;
        trafficByVideo[id].total += v;
        if (ALGO_SOURCES.has(String(r.dimension_value).toUpperCase())) trafficByVideo[id].algo += v;
      }

      // Video metadata
      const allVideoIds = Object.keys(dailyByVideo);
      let metaByVideo = {};
      if (allVideoIds.length > 0) {
        const { data: metaRows } = await supabase
          .from('content_items')
          .select('external_id, title, thumbnail_url, url, published_at, duration_seconds, content_type')
          .in('external_id', allVideoIds);
        for (const m of (metaRows || [])) metaByVideo[m.external_id] = m;
      }

      // Build raw video rows
      const raw = allVideoIds.map(id => {
        const d = dailyByVideo[id];
        const s = subByVideo[id] || { sub_views: 0, unsub_views: 0, sub_watch: 0, unsub_watch: 0, sub_avd_n: 0, sub_avd_sum: 0, unsub_avd_n: 0, unsub_avd_sum: 0 };
        const t = trafficByVideo[id] || { total: 0, algo: 0 };
        const meta = metaByVideo[id] || {};
        const totalSubBreakdownViews = s.sub_views + s.unsub_views;
        const returningPct = totalSubBreakdownViews > 0 ? s.sub_views / totalSubBreakdownViews : 0;
        const newPct = totalSubBreakdownViews > 0 ? s.unsub_views / totalSubBreakdownViews : 0;
        const subAvd = s.sub_avd_n > 0 ? s.sub_avd_sum / s.sub_avd_n : 0;
        const unsubAvd = s.unsub_avd_n > 0 ? s.unsub_avd_sum / s.unsub_avd_n : 0;
        const avgAvd = d.avd_n > 0 ? d.avd_sum / d.avd_n : 0;
        const avgApv = d.apv_n > 0 ? d.apv_sum / d.apv_n : 0; // avg % viewed = completion proxy
        const engagement = d.views > 0 ? (d.likes + d.comments + d.shares) / d.views : 0;
        const subConv = d.views > 0 ? d.subs / d.views : 0;
        const algoPct = t.total > 0 ? t.algo / t.total : 0;
        return {
          video_id: id,
          title: meta.title || id,
          thumbnail_url: meta.thumbnail_url,
          url: meta.url,
          published_at: meta.published_at,
          duration_seconds: meta.duration_seconds,
          content_type: meta.content_type,
          total_views: d.views,
          watch_time_minutes: d.watch_time_minutes,
          avg_view_duration_seconds: avgAvd,
          engagement_rate: engagement,
          sub_conversion: subConv,
          // Stability inputs
          returning_watch_time: s.sub_watch,
          returning_view_pct: returningPct,
          returning_avd: subAvd,
          subscribed_views: s.sub_views,
          // Growth inputs
          new_viewer_volume: s.unsub_views,
          new_viewer_pct: newPct,
          new_viewer_retention: unsubAvd,
          new_sub_conversion: s.unsub_views > 0 ? d.subs / s.unsub_views : 0, // approximation
          algo_traffic_pct: algoPct,
          // Short-form inputs (completion, spread, acquisition)
          avg_view_percentage: avgApv,
          completion_pct: avgApv,
          total_shares: d.shares,
          subscribers_gained: d.subs,
          shares_per_view: d.views > 0 ? d.shares / d.views : 0,
          follows_per_1k: d.views > 0 ? (d.subs / d.views) * 1000 : 0,
        };
      });

      // Score long-form and Shorts SEPARATELY — each cohort normalized against its
      // own trailing-median set (never pooled), per Trevor's format-split model.
      const byRecency = (a, b) => {
        const ad = a.published_at ? new Date(a.published_at).getTime() : 0;
        const bd = b.published_at ? new Date(b.published_at).getTime() : 0;
        return bd - ad;
      };
      const longRaw = raw.filter(v => v.content_type !== 'short').sort(byRecency);
      const shortRaw = raw.filter(v => v.content_type === 'short').sort(byRecency);
      const scoredLong = scoreLongForm(longRaw, SW, GW);
      const scoredShort = scoreShortForm(shortRaw, SHORT_WEIGHTS_BY_ROLE[role] || SHORT_WEIGHTS_BY_ROLE.broad);

      if (gen !== fetchGenRef.current) return; // a newer channel switch superseded this fetch
      setVideosLong(scoredLong);
      setVideosShort(scoredShort);
    } catch (e) {
      console.error('Content Health fetch error:', e);
    } finally {
      if (gen === fetchGenRef.current) setLoading(false);
    }
  }

  // Channel-level Growth/Stability KPIs over a trailing window vs the prior equal
  // window. Sources are the channel-dim daily tables (real daily history) + a
  // lifetime impressions/CTR scorecard from analytics_youtube (manual Studio CSV).
  async function fetchChannelKpis() {
    const gen = ++kpiGenRef.current;
    setKpisLoading(true);
    try {
      const acct = account;
      const csvKey = acct && acct.external_id ? CSV_CHANNEL_BY_EXT[acct.external_id] : null;
      const since = new Date(Date.now() - (KPI_WINDOW * 2 + 6) * 86400000).toISOString().split('T')[0];

      const [subRes, trafRes, vdRes, stRes, ayRes, ciRes] = await Promise.all([
        supabase.from('yt_dim_subscription_status').select('date, dimension_value, views, watch_time_minutes, average_view_duration_seconds').eq('platform_account_id', activeChannelId).gte('date', since),
        supabase.from('yt_dim_traffic_source').select('date, dimension_value, views').eq('platform_account_id', activeChannelId).gte('date', since),
        supabase.from('yt_video_daily').select('date, views, subscribers_gained, average_view_percentage').eq('platform_account_id', activeChannelId).gte('date', since).limit(50000),
        supabase.from('yt_dim_search_terms').select('date, dimension_value, views').eq('platform_account_id', activeChannelId).gte('date', since),
        csvKey ? supabase.from('analytics_youtube').select('impressions, impressions_ctr, created_at').eq('channel', csvKey) : Promise.resolve({ data: [] }),
        supabase.from('content_items').select('published_at').eq('platform_account_id', activeChannelId).gte('published_at', since),
      ]);

      // Ordered set of finalized dates present in the daily dims → split into
      // current window (last N) and prior window (the N before).
      const dateSet = new Set();
      for (const r of (subRes.data || [])) dateSet.add(r.date);
      for (const r of (trafRes.data || [])) dateSet.add(r.date);
      const dates = Array.from(dateSet).sort();
      const curDates = dates.slice(-KPI_WINDOW);
      const priorDates = dates.slice(-KPI_WINDOW * 2, -KPI_WINDOW);
      const curStart = curDates[0], curEnd = curDates[curDates.length - 1];
      const priorStart = priorDates[0], priorEnd = priorDates[priorDates.length - 1];
      const inRange = (d, a, b) => !!a && !!b && d >= a && d <= b;

      const byDate = {};
      const ensure = (d) => (byDate[d] = byDate[d] || { sub: 0, unsub: 0, avdNum: 0, avdDen: 0, traf: {}, trafTotal: 0, vdSubs: 0, vdViews: 0, apvNum: 0, apvDen: 0 });
      for (const r of (subRes.data || [])) {
        const b = ensure(r.date), v = Number(r.views) || 0, avd = Number(r.average_view_duration_seconds) || 0;
        if (String(r.dimension_value).toUpperCase() === 'SUBSCRIBED') b.sub += v; else b.unsub += v;
        b.avdNum += avd * v; b.avdDen += v;
      }
      for (const r of (trafRes.data || [])) {
        const b = ensure(r.date), v = Number(r.views) || 0, code = String(r.dimension_value).toUpperCase();
        b.traf[code] = (b.traf[code] || 0) + v; b.trafTotal += v;
      }
      for (const r of (vdRes.data || [])) {
        const b = ensure(r.date), v = Number(r.views) || 0;
        b.vdSubs += Number(r.subscribers_gained) || 0; b.vdViews += v;
        b.apvNum += (Number(r.average_view_percentage) || 0) * v; b.apvDen += v;
      }

      let curPub = 0, priorPub = 0;
      for (const r of (ciRes.data || [])) {
        const d = r.published_at ? String(r.published_at).slice(0, 10) : null;
        if (!d) continue;
        if (inRange(d, curStart, curEnd)) curPub++;
        else if (inRange(d, priorStart, priorEnd)) priorPub++;
      }

      const safe = (n, d) => (d > 0 ? n / d : 0);
      const agg = (dateList) => {
        const a = { sub: 0, unsub: 0, avdNum: 0, avdDen: 0, traf: {}, trafTotal: 0, vdSubs: 0, vdViews: 0, apvNum: 0, apvDen: 0 };
        for (const d of dateList) {
          const b = byDate[d]; if (!b) continue;
          a.sub += b.sub; a.unsub += b.unsub; a.avdNum += b.avdNum; a.avdDen += b.avdDen;
          a.trafTotal += b.trafTotal; a.vdSubs += b.vdSubs; a.vdViews += b.vdViews; a.apvNum += b.apvNum; a.apvDen += b.apvDen;
          for (const k in b.traf) a.traf[k] = (a.traf[k] || 0) + b.traf[k];
        }
        return a;
      };
      const derive = (a, pubCount) => {
        const totalSub = a.sub + a.unsub, tt = a.trafTotal;
        return {
          new_pct: safe(a.unsub, totalSub),
          returning_pct: safe(a.sub, totalSub),
          new_volume: a.unsub,
          returning_volume: a.sub,
          avd: safe(a.avdNum, a.avdDen),
          apv: safe(a.apvNum, a.apvDen),
          search_share: safe(a.traf[TRAFFIC.search] || 0, tt),
          suggested_share: safe(a.traf[TRAFFIC.suggested] || 0, tt),
          browse_suggested_share: safe((a.traf[TRAFFIC.browse] || 0) + (a.traf[TRAFFIC.suggested] || 0), tt),
          playlist_endscreen_share: safe((a.traf[TRAFFIC.playlist] || 0) + (a.traf[TRAFFIC.endScreen] || 0), tt),
          subs_gained: a.vdSubs,
          subs_per_1k: safe(a.vdSubs, a.vdViews) * 1000,
          subs_per_video: pubCount > 0 ? a.vdSubs / pubCount : 0,
        };
      };
      const curV = derive(agg(curDates), curPub), priorV = derive(agg(priorDates), priorPub);

      const dailySeries = (fn) => curDates.map(d => { const b = byDate[d]; return b ? fn(b) : 0; });
      const series = {
        new_pct: dailySeries(b => safe(b.unsub, b.sub + b.unsub)),
        returning_pct: dailySeries(b => safe(b.sub, b.sub + b.unsub)),
        new_volume: dailySeries(b => b.unsub),
        returning_volume: dailySeries(b => b.sub),
        avd: dailySeries(b => safe(b.avdNum, b.avdDen)),
        apv: dailySeries(b => safe(b.apvNum, b.apvDen)),
        search_share: dailySeries(b => safe(b.traf[TRAFFIC.search] || 0, b.trafTotal)),
        suggested_share: dailySeries(b => safe(b.traf[TRAFFIC.suggested] || 0, b.trafTotal)),
        browse_suggested_share: dailySeries(b => safe((b.traf[TRAFFIC.browse] || 0) + (b.traf[TRAFFIC.suggested] || 0), b.trafTotal)),
        playlist_endscreen_share: dailySeries(b => safe((b.traf[TRAFFIC.playlist] || 0) + (b.traf[TRAFFIC.endScreen] || 0), b.trafTotal)),
        subs_gained: dailySeries(b => b.vdSubs),
        subs_per_1k: dailySeries(b => safe(b.vdSubs, b.vdViews) * 1000),
      };

      const metrics = {};
      for (const k of Object.keys(curV)) metrics[k] = { value: curV[k], prev: priorV[k], series: series[k] || null };

      // Rising search terms — current-window views minus prior-window views.
      const termCur = {}, termPrior = {};
      for (const r of (stRes.data || [])) {
        const term = r.dimension_value, v = Number(r.views) || 0, d = r.date;
        if (inRange(d, curStart, curEnd)) termCur[term] = (termCur[term] || 0) + v;
        else if (inRange(d, priorStart, priorEnd)) termPrior[term] = (termPrior[term] || 0) + v;
      }
      const risingTerms = Object.keys(termCur)
        .map(t => ({ term: t, views: termCur[t], delta: termCur[t] - (termPrior[t] || 0) }))
        .sort((a, b) => b.delta - a.delta)
        .slice(0, 5);

      // Lifetime impressions/CTR scorecard (Studio CSV — stale, no daily series).
      let impressions = null;
      const ay = ayRes.data || [];
      if (ay.length > 0) {
        let imprSum = 0, ctrNum = 0, ctrDen = 0, asOf = null;
        for (const r of ay) {
          const im = Number(r.impressions) || 0, ct = Number(r.impressions_ctr) || 0;
          imprSum += im; ctrNum += ct * im; ctrDen += im;
          if (r.created_at && (!asOf || r.created_at > asOf)) asOf = r.created_at;
        }
        impressions = { impressions: imprSum, ctr: ctrDen > 0 ? ctrNum / ctrDen : 0, asOf, videos: ay.length };
      }

      const result = { metrics, risingTerms, impressions, curStart, curEnd, hasWindow: curDates.length > 0 };
      if (gen !== kpiGenRef.current) return;
      setKpis(result);
    } catch (e) {
      console.error('Content Health KPI fetch error:', e);
      if (gen === kpiGenRef.current) setKpis(null);
    } finally {
      if (gen === kpiGenRef.current) setKpisLoading(false);
    }
  }

  // ── Channel mix card (rolling last 12 published videos) ──
  // Per-format splittable KPI tiles. Channel-dim tables blend Shorts, so these come
  // from PER-VIDEO yt_video_daily joined to content_type (real daily history →
  // sparklines + prior-window deltas). new/returning per format comes from
  // yt_video_dim_subscription_status (thin — only fills in as the daily sync runs).
  // Impressions/CTR split by format from analytics_youtube (lifetime, stale).
  async function fetchFormatKpis() {
    const gen = ++formatGenRef.current;
    try {
      const since = new Date(Date.now() - (KPI_WINDOW * 2 + 6) * 86400000).toISOString().split('T')[0];
      const acct = account;
      const csvKey = acct && acct.external_id ? CSV_CHANNEL_BY_EXT[acct.external_id] : null;
      const [vdRes, ciRes, subRes, ayRes] = await Promise.all([
        supabase.from('yt_video_daily').select('date, video_id, views, watch_time_minutes, average_view_duration_seconds, average_view_percentage, subscribers_gained, likes, comments, shares').eq('platform_account_id', activeChannelId).gte('date', since).limit(50000),
        supabase.from('content_items').select('external_id, content_type, published_at').eq('platform_account_id', activeChannelId),
        supabase.from('yt_video_dim_subscription_status').select('date, video_id, dimension_value, views').eq('platform_account_id', activeChannelId).gte('date', since),
        csvKey ? supabase.from('analytics_youtube').select('video_id, impressions, impressions_ctr, created_at').eq('channel', csvKey) : Promise.resolve({ data: [] }),
      ]);
      const typeOf = {}, pubOf = {};
      for (const c of (ciRes.data || [])) { typeOf[c.external_id] = c.content_type; pubOf[c.external_id] = c.published_at ? String(c.published_at).slice(0, 10) : null; }
      const fmtOf = (vid) => (typeOf[vid] === 'short' ? 'short' : 'video'); // default long

      // date universe from yt_video_daily
      const dset = new Set();
      for (const r of (vdRes.data || [])) dset.add(r.date);
      const dates = Array.from(dset).sort();
      const curDates = dates.slice(-KPI_WINDOW), priorDates = dates.slice(-KPI_WINDOW * 2, -KPI_WINDOW);
      const curSet = new Set(curDates), priorSet = new Set(priorDates);
      const curStart = curDates[0], curEnd = curDates[curDates.length - 1];
      const priorStart = priorDates[0], priorEnd = priorDates[priorDates.length - 1];
      const inR = (d, a, b) => !!a && !!b && d >= a && d <= b;

      // per-format, per-date accumulators
      const mk = () => ({ views: 0, watch: 0, avdN: 0, avdD: 0, apvN: 0, apvD: 0, subs: 0, shares: 0, eng: 0 });
      const byFmtDate = { video: {}, short: {} };
      for (const r of (vdRes.data || [])) {
        const f = fmtOf(r.video_id); const day = (byFmtDate[f][r.date] = byFmtDate[f][r.date] || mk());
        const v = Number(r.views) || 0;
        day.views += v; day.watch += Number(r.watch_time_minutes) || 0; day.subs += Number(r.subscribers_gained) || 0;
        day.shares += Number(r.shares) || 0; day.eng += (Number(r.likes) || 0) + (Number(r.comments) || 0) + (Number(r.shares) || 0);
        day.avdN += (Number(r.average_view_duration_seconds) || 0) * v; day.avdD += v;
        day.apvN += (Number(r.average_view_percentage) || 0) * v; day.apvD += v;
      }
      // new/returning per format, split into current + prior windows (+ a daily
      // series for the current window). Coverage is thin — the per-video sub table
      // only fills in as the daily sync runs — so the prior window may be empty,
      // in which case buildFmt leaves `prev` null (no false delta).
      const mkSub = () => ({ sub: 0, unsub: 0 });
      const subFmt = { video: { cur: mkSub(), prior: mkSub() }, short: { cur: mkSub(), prior: mkSub() } };
      const subByFmtDate = { video: {}, short: {} };
      for (const r of (subRes.data || [])) {
        const inCur = curSet.has(r.date), inPrior = priorSet.has(r.date);
        if (!inCur && !inPrior) continue;
        const f = fmtOf(r.video_id), v = Number(r.views) || 0;
        const isSub = String(r.dimension_value).toUpperCase() === 'SUBSCRIBED';
        const bucket = inCur ? subFmt[f].cur : subFmt[f].prior;
        if (isSub) bucket.sub += v; else bucket.unsub += v;
        if (inCur) {
          const day = (subByFmtDate[f][r.date] = subByFmtDate[f][r.date] || mkSub());
          if (isSub) day.sub += v; else day.unsub += v;
        }
      }
      // videos published per format per window
      const pub = { video: { cur: 0, prior: 0 }, short: { cur: 0, prior: 0 } };
      for (const vid in pubOf) { const d = pubOf[vid]; if (!d) continue; const f = fmtOf(vid);
        if (inR(d, curStart, curEnd)) pub[f].cur++; else if (inR(d, priorStart, priorEnd)) pub[f].prior++; }
      // impressions per format (lifetime)
      const impFmt = { video: { imp: 0, cN: 0, cD: 0, n: 0, asOf: null }, short: { imp: 0, cN: 0, cD: 0, n: 0, asOf: null } };
      for (const r of (ayRes.data || [])) { const f = fmtOf(r.video_id); const im = Number(r.impressions) || 0, ct = Number(r.impressions_ctr) || 0;
        impFmt[f].imp += im; impFmt[f].cN += ct * im; impFmt[f].cD += im; impFmt[f].n++;
        if (r.created_at && (!impFmt[f].asOf || r.created_at > impFmt[f].asOf)) impFmt[f].asOf = r.created_at; }

      const safe = (n, d) => (d > 0 ? n / d : 0);
      const buildFmt = (f) => {
        const aggW = (list) => { const a = mk(); for (const d of list) { const b = byFmtDate[f][d]; if (!b) continue;
          a.views += b.views; a.watch += b.watch; a.avdN += b.avdN; a.avdD += b.avdD; a.apvN += b.apvN; a.apvD += b.apvD; a.subs += b.subs; a.shares += b.shares; a.eng += b.eng; } return a; };
        const cur = aggW(curDates), prior = aggW(priorDates);
        const metricsOf = (a, pubCount) => ({
          views: a.views, watch_hours: a.watch / 60, avd: safe(a.avdN, a.avdD), apv: safe(a.apvN, a.apvD),
          subs_gained: a.subs, engagement: safe(a.eng, a.views), shares_per_view: safe(a.shares, a.views),
          subs_per_1k: safe(a.subs, a.views) * 1000, subs_per_video: pubCount > 0 ? a.subs / pubCount : 0,
        });
        const cm = metricsOf(cur, pub[f].cur), pm = metricsOf(prior, pub[f].prior);
        const daily = (fn) => curDates.map(d => { const b = byFmtDate[f][d]; return b ? fn(b) : 0; });
        const series = {
          views: daily(b => b.views), watch_hours: daily(b => b.watch / 60), avd: daily(b => safe(b.avdN, b.avdD)),
          apv: daily(b => safe(b.apvN, b.apvD)), subs_gained: daily(b => b.subs), engagement: daily(b => safe(b.eng, b.views)),
          shares_per_view: daily(b => safe(b.shares, b.views)), subs_per_1k: daily(b => safe(b.subs, b.views) * 1000),
        };
        const metrics = {};
        for (const k of Object.keys(cm)) metrics[k] = { value: cm[k], prev: pm[k], series: series[k] || null };
        const sc = subFmt[f].cur, sp = subFmt[f].prior;
        const totalSub = sc.sub + sc.unsub, priorSub = sp.sub + sp.unsub;
        // Prior window is often empty (per-video sub sync is thin) → leave prev
        // null so the tile shows no delta rather than a bogus +100%.
        const subDaily = (fn) => curDates.map(d => { const b = subByFmtDate[f][d]; return b ? fn(b) : 0; });
        metrics.new_pct = { value: safe(sc.unsub, totalSub), prev: priorSub > 0 ? safe(sp.unsub, priorSub) : null, series: subDaily(b => safe(b.unsub, b.sub + b.unsub)) };
        metrics.returning_pct = { value: safe(sc.sub, totalSub), prev: priorSub > 0 ? safe(sp.sub, priorSub) : null, series: subDaily(b => safe(b.sub, b.sub + b.unsub)) };
        metrics.new_volume = { value: sc.unsub, prev: priorSub > 0 ? sp.unsub : null, series: subDaily(b => b.unsub) };
        metrics.returning_volume = { value: sc.sub, prev: priorSub > 0 ? sp.sub : null, series: subDaily(b => b.sub) };
        const im = impFmt[f];
        const impressions = im.n > 0 ? { impressions: im.imp, ctr: safe(im.cN, im.cD), asOf: im.asOf, videos: im.n } : null;
        return { metrics, impressions, subThin: totalSub > 0 };
      };

      const result = { long: buildFmt('video'), short: buildFmt('short'), window: KPI_WINDOW };
      if (gen !== formatGenRef.current) return;
      setFormatKpis(result);
    } catch (e) {
      console.error('Content Health format-KPI error:', e);
      if (gen === formatGenRef.current) setFormatKpis(null);
    }
  }

  const activeVideos = view === 'short' ? videosShort : videosLong;
  const channelMix = useMemo(() => {
    if (activeVideos.length === 0) return null;
    const last12 = activeVideos.slice(0, 12);
    const buckets = { stability: 0, growth: 0, breakout: 0, underperforming: 0 };
    for (const v of last12) buckets[v.category] = (buckets[v.category] || 0) + 1;
    const prev12 = activeVideos.slice(12, 24);
    const prevBuckets = { stability: 0, growth: 0, breakout: 0, underperforming: 0 };
    for (const v of prev12) prevBuckets[v.category] = (prevBuckets[v.category] || 0) + 1;
    return { current: buckets, previous: prevBuckets, total: last12.length, prevTotal: prev12.length };
  }, [activeVideos]);

  // ── Render (single channel column) ──
  const selectedVideo = activeVideos.find(v => v.video_id === selectedVideoId);
  const activeWeights = view === 'short' ? shortsDisplayWeights(activeRole) : weightsForRole(activeRole);
  const fmtK = formatKpis ? (view === 'short' ? formatKpis.short : formatKpis.long) : null;
  const roleColor = activeRole === 'niche' ? '#5b8fc7' : '#ff4444';

  return (
    <div style={S.column}>
      <div style={S.columnHead}>
        <span style={{ ...S.columnDot, background: roleColor }} />
        <div>
          <div style={S.columnName}>{account.account_name}</div>
          <div style={S.columnRole}>{activeRole === 'niche' ? 'Niche / search-driven' : 'Broad-reach'}</div>
        </div>
      </div>

      {view === 'short' ? (
        <ShortsFamilyCard metrics={fmtK ? fmtK.metrics : null} loading={!formatKpis} shortsCount={activeVideos.length} />
      ) : (
        <>
          <KpiSection icon="🚀" title="Growth" subtitle={`long-form · ${KPI_WINDOW}d vs prior ${KPI_WINDOW}d`}
            tiles={LONG_GROWTH_TILES[activeRole]} kpis={fmtK} color={CATEGORY_COLORS.growth} loading={!formatKpis} />
          <KpiSection icon="🛡️" title="Stability" subtitle={`long-form · ${KPI_WINDOW}d vs prior ${KPI_WINDOW}d`}
            tiles={LONG_STABILITY_TILES[activeRole]} kpis={fmtK} color={CATEGORY_COLORS.stability} loading={!formatKpis} unavailable={UNAVAILABLE_STABILITY} />
        </>
      )}

      {/* Traffic mix + search terms are whole-channel (all formats) — badged, never
          presented as format-specific numbers. */}
      <ContextStrip kpis={kpis} loading={kpisLoading} />

      {/* Secondary, collapsed by default: per-video scatter + ranked table + modal. */}
      <button style={S.drillToggle} onClick={() => setDrillOpen(o => !o)}>
        {drillOpen ? '▾' : '▸'} Per-video detail — {activeVideos.length} {view === 'short' ? 'Shorts' : 'long-form videos'}
      </button>
      {drillOpen && (
        <>
          {channelMix && <ChannelMixCard mix={channelMix} />}
          <div style={S.card}>
            <div style={S.cardHeader}>
              <span style={S.cardTitle}>{view === 'short' ? 'Retention × Spread' : 'Stability × Growth'}</span>
              <div style={S.legend}>
                {Object.entries(CATEGORY_COLORS).map(([cat, color]) => (
                  <span key={cat} style={S.legendItem}><span style={{ ...S.legendDot, background: color }} />{cat}</span>
                ))}
              </div>
            </div>
            <ScatterPlot videos={activeVideos} onSelect={setSelectedVideoId}
              xLabel={view === 'short' ? 'Retention (Hold) →' : 'Stability Score →'}
              yLabel={view === 'short' ? 'Spread (Amplify + Convert) →' : 'Growth Score →'} />
            {loading && <div style={S.loadingOverlay}>Loading…</div>}
          </div>
          <div style={S.card}>
            <div style={S.cardHeader}>
              <span style={S.cardTitle}>{view === 'short' ? 'All scored Shorts' : 'All scored long-form videos'}</span>
            </div>
            <RankedTable videos={activeVideos} onSelect={setSelectedVideoId} />
          </div>
        </>
      )}

      {selectedVideo && (
        <DetailPanel video={selectedVideo} weights={activeWeights} onClose={() => setSelectedVideoId(null)} />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Top-level: two YouTube channel columns side by side under Long/Short tabs.
// Short-form tab adds a cross-platform reach banner on top and stacked
// TikTok / IG / FB platform panels below the two YT columns.
// ═══════════════════════════════════════════════════════════════════
export default function ContentHealthDashboard({ accounts }) {
  const ytChannels = useMemo(() => (accounts || []).filter(a => a.platform === 'youtube'), [accounts]);
  const [view, setView] = useState('long'); // 'long' | 'short'
  const [cross, setCross] = useState(null);  // cross-platform reach + stacked-panel data
  const crossGenRef = useRef(0);

  useEffect(() => {
    if (ytChannels.length === 0) return;
    fetchCrossPlatform();
    // eslint-disable-next-line
  }, [accounts]);

  async function fetchCrossPlatform() {
    const gen = ++crossGenRef.current;
    try {
      const W = 30;              // window length (days)
      const dayMs = 86400000;
      const curStart = new Date(Date.now() - W * dayMs).toISOString().split('T')[0];
      const prevStart = new Date(Date.now() - 2 * W * dayMs).toISOString().split('T')[0];
      const inCur = (d) => d >= curStart; // else it's the prior window
      const ytIds = ytChannels.map(c => c.id);
      const SF = ['tiktok', 'instagram', 'facebook'];
      const [ciRes, vdRes, cpRes, audRes] = await Promise.all([
        supabase.from('content_items').select('external_id').in('platform_account_id', ytIds).eq('content_type', 'short'),
        supabase.from('yt_video_daily').select('video_id, views, date').in('platform_account_id', ytIds).gte('date', prevStart).limit(50000),
        supabase.from('platform_daily_metrics').select('date, views, likes, reach, engaged_accounts, platform_accounts!inner(platform)').in('platform_accounts.platform', SF).gte('date', prevStart),
        supabase.from('audience_snapshots').select('date, followers_gained, platform_accounts!inner(platform)').in('platform_accounts.platform', [...SF, 'youtube']).gte('date', prevStart),
      ]);

      // YouTube Shorts views, split current / prior
      const shortIds = new Set((ciRes.data || []).map(c => c.external_id));
      let ytViews = 0, ytPrev = 0;
      for (const r of (vdRes.data || [])) {
        if (!shortIds.has(r.video_id)) continue;
        const v = Number(r.views) || 0;
        if (inCur(r.date)) ytViews += v; else ytPrev += v;
      }

      // Non-YT platforms: current + prior sums + daily views series (for sparklines)
      const platforms = {};
      const seriesMap = {};
      for (const key of SF) {
        platforms[key] = { views: 0, likes: 0, reach: 0, engaged: 0, prev: { views: 0, likes: 0, reach: 0, engaged: 0 } };
        seriesMap[key] = {};
      }
      for (const r of (cpRes.data || [])) {
        const p = r.platform_accounts.platform;
        const t = platforms[p];
        if (!t) continue;
        const b = inCur(r.date) ? t : t.prev;
        b.views += Number(r.views) || 0;
        b.likes += Number(r.likes) || 0;
        b.reach += Number(r.reach) || 0;
        b.engaged += Number(r.engaged_accounts) || 0;
        if (inCur(r.date)) seriesMap[p][r.date] = (seriesMap[p][r.date] || 0) + (Number(r.views) || 0);
      }
      for (const key of SF) {
        platforms[key].series = Object.entries(seriesMap[key])
          .sort(([a], [b]) => a.localeCompare(b)).map(([date, views]) => ({ date, views }));
      }

      // Follower growth, split current / prior
      const follows = {}, followsPrev = {};
      for (const r of (audRes.data || [])) {
        const p = r.platform_accounts.platform;
        const g = Number(r.followers_gained) || 0;
        if (inCur(r.date)) follows[p] = (follows[p] || 0) + g;
        else followsPrev[p] = (followsPrev[p] || 0) + g;
      }

      const result = { window: W, yt: { views: ytViews, prevViews: ytPrev }, platforms, follows, followsPrev };
      if (gen !== crossGenRef.current) return;
      setCross(result);
    } catch (e) {
      console.error('Content Health cross-platform error:', e);
      if (gen === crossGenRef.current) setCross(null);
    }
  }

  if (ytChannels.length === 0) {
    return <div style={S.emptyCard}><p style={S.emptyText}>No YouTube channels connected.</p></div>;
  }

  return (
    <div>
      <div style={S.header}>
        <div style={S.headerLeft}>
          <span style={S.title}>Content Health</span>
          <span style={S.subtitle}>Both channels side by side · {view === 'short' ? 'Short-form' : 'Long-form'}</span>
        </div>
        <div style={S.viewTabs}>
          {[['long', 'Long-form'], ['short', 'Short-form']].map(([k, label]) => (
            <button key={k} onClick={() => setView(k)} style={{ ...S.viewTab, ...(view === k ? S.viewTabActive : {}) }}>{label}</button>
          ))}
        </div>
      </div>

      {view === 'short' && <CrossPlatformSummary data={cross} />}

      <div style={S.columnsGrid}>
        {ytChannels.map(c => <ChannelColumn key={c.id} account={c} view={view} />)}
      </div>

      {view === 'short' && (
        <div style={S.platformStack}>
          {SF_PLATFORMS.filter(p => p.key !== 'youtube').map(p => (
            <PlatformPanel key={p.key} platform={p} data={cross} />
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Channel-mix card
// ═══════════════════════════════════════════════════════════════════
function ChannelMixCard({ mix }) {
  const pct = (n) => mix.total > 0 ? Math.round((n / mix.total) * 100) : 0;
  const prevPct = (n) => mix.prevTotal > 0 ? Math.round((n / mix.prevTotal) * 100) : 0;
  const cats = ['breakout','stability','growth','underperforming'];
  return (
    <div style={S.mixCard}>
      <div style={S.mixHeader}>
        <span style={S.mixTitle}>Channel Mix · last {mix.total} videos</span>
        {mix.prevTotal > 0 && <span style={S.mixSubtitle}>vs previous {mix.prevTotal}</span>}
      </div>
      <div style={S.mixBars}>
        {cats.map(cat => {
          const cur = mix.current[cat] || 0;
          const prev = mix.previous[cat] || 0;
          const curP = pct(cur);
          const prevP = prevPct(prev);
          const delta = curP - prevP;
          return (
            <div key={cat} style={S.mixItem}>
              <div style={S.mixLabel}>
                <span style={{ ...S.legendDot, background: CATEGORY_COLORS[cat] }} />
                {cat}
              </div>
              <div style={S.mixBarOuter}>
                <div style={{ ...S.mixBarInner, width: `${curP}%`, background: CATEGORY_COLORS[cat] }} />
              </div>
              <div style={S.mixCount}>
                {cur} <span style={{ color: 'rgba(255,255,255,0.4)' }}>({curP}%)</span>
                {mix.prevTotal > 0 && (
                  <span style={{ marginLeft: 6, color: delta > 0 ? '#22c55e' : delta < 0 ? '#f87171' : 'rgba(255,255,255,0.3)', fontSize: 11 }}>
                    {delta > 0 ? '+' : ''}{delta}pp
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Scatter plot
// ═══════════════════════════════════════════════════════════════════
function ScatterPlot({ videos, onSelect, xLabel = 'Stability Score →', yLabel = 'Growth Score →' }) {
  const [hover, setHover] = useState(null);
  const W = 900, H = 500, PAD = { top: 24, right: 32, bottom: 48, left: 56 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  if (videos.length === 0) {
    return <div style={{ padding: 60, textAlign: 'center', color: 'rgba(255,255,255,0.4)' }}>No scored videos yet.</div>;
  }

  // Dot size by views (sqrt scale)
  const maxViews = Math.max(...videos.map(v => v.total_views), 1);
  const radiusFor = (v) => Math.max(3, Math.min(20, 3 + Math.sqrt(v.total_views / maxViews) * 17));

  const xFor = (s) => PAD.left + (s / 100) * plotW;
  const yFor = (g) => PAD.top + plotH - (g / 100) * plotH;

  // Quadrant lines at 60 (breakout gate)
  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 500, display: 'block' }}>
        {/* Axes */}
        <line x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} stroke="rgba(255,255,255,0.15)" />
        <line x1={PAD.left} x2={PAD.left} y1={PAD.top} y2={H - PAD.bottom} stroke="rgba(255,255,255,0.15)" />

        {/* Breakout-gate quadrant lines */}
        <line x1={xFor(BREAKOUT_GATE.stability)} x2={xFor(BREAKOUT_GATE.stability)} y1={PAD.top} y2={H - PAD.bottom} stroke="rgba(245,158,11,0.2)" strokeDasharray="4 4" />
        <line x1={PAD.left} x2={W - PAD.right} y1={yFor(BREAKOUT_GATE.growth)} y2={yFor(BREAKOUT_GATE.growth)} stroke="rgba(245,158,11,0.2)" strokeDasharray="4 4" />

        {/* Axis labels */}
        <text x={PAD.left + plotW / 2} y={H - 14} textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="12">{xLabel}</text>
        <text x={16} y={PAD.top + plotH / 2} textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="12" transform={`rotate(-90 16 ${PAD.top + plotH / 2})`}>{yLabel}</text>

        {/* Tick labels */}
        {[0, 25, 50, 75, 100].map(t => (
          <g key={t}>
            <text x={xFor(t)} y={H - PAD.bottom + 16} textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="10">{t}</text>
            <text x={PAD.left - 8} y={yFor(t) + 4} textAnchor="end" fill="rgba(255,255,255,0.4)" fontSize="10">{t}</text>
          </g>
        ))}

        {/* Dots */}
        {videos.map(v => {
          const color = CATEGORY_COLORS[v.category];
          return (
            <circle key={v.video_id}
              cx={xFor(v.stability_score)}
              cy={yFor(v.growth_score)}
              r={radiusFor(v)}
              fill={color}
              fillOpacity={hover === v.video_id ? 0.95 : 0.6}
              stroke={hover === v.video_id ? '#fff' : color}
              strokeWidth={hover === v.video_id ? 2 : 1}
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHover(v.video_id)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelect(v.video_id)}
            />
          );
        })}
      </svg>

      {/* Hover tooltip */}
      {hover && (() => {
        const v = videos.find(x => x.video_id === hover);
        if (!v) return null;
        return (
          <div style={S.scatterTooltip}>
            <div style={S.tipTitle}>{v.title}</div>
            <div style={S.tipMeta}>{formatNumber(v.total_views)} views · {v.category}</div>
            <div style={S.tipScores}>
              S {v.stability_score.toFixed(0)} · G {v.growth_score.toFixed(0)} · B {v.breakout_raw.toFixed(0)}
              {v.is_breakout && <span style={{ color: '#f59e0b', marginLeft: 6 }}>★ BREAKOUT</span>}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Ranked table
// ═══════════════════════════════════════════════════════════════════
function RankedTable({ videos, onSelect }) {
  const [sort, setSort] = useState({ col: 'breakout_raw', dir: 'desc' });
  const sorted = useMemo(() => {
    return [...videos].sort((a, b) => {
      const av = a[sort.col] || 0;
      const bv = b[sort.col] || 0;
      if (typeof av === 'string') return sort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return sort.dir === 'asc' ? av - bv : bv - av;
    });
  }, [videos, sort]);
  const handleSort = (col) => setSort(s => ({ col, dir: s.col === col && s.dir === 'desc' ? 'asc' : 'desc' }));

  const cols = [
    { key: 'title', label: 'Video', sortable: false },
    { key: 'published_at', label: 'Published' },
    { key: 'total_views', label: 'Views' },
    { key: 'stability_score', label: 'Stability' },
    { key: 'growth_score', label: 'Growth' },
    { key: 'breakout_raw', label: 'Breakout' },
    { key: 'category', label: 'Category' },
  ];

  return (
    <div style={S.tableScroll}>
      <table style={S.table}>
        <thead><tr>
          {cols.map(c => (
            <th key={c.key} onClick={c.sortable !== false ? () => handleSort(c.key) : undefined}
              style={{ ...S.th, cursor: c.sortable !== false ? 'pointer' : 'default', textAlign: c.key === 'title' ? 'left' : 'right' }}>
              {c.label}{sort.col === c.key ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
            </th>
          ))}
        </tr></thead>
        <tbody>
          {sorted.map(v => (
            <tr key={v.video_id} onClick={() => onSelect(v.video_id)} style={{ cursor: 'pointer' }}>
              <td style={S.td}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {v.thumbnail_url && <img src={v.thumbnail_url} alt="" style={S.thumb} />}
                  <span style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.title}</span>
                </div>
              </td>
              <td style={{ ...S.td, textAlign: 'right', color: 'rgba(255,255,255,0.5)' }}>{formatDate(v.published_at)}</td>
              <td style={{ ...S.td, textAlign: 'right' }}>{formatNumber(v.total_views)}</td>
              <td style={{ ...S.td, textAlign: 'right', color: colors.accentFg }}>{v.stability_score.toFixed(0)}</td>
              <td style={{ ...S.td, textAlign: 'right', color: '#86efac' }}>{v.growth_score.toFixed(0)}</td>
              <td style={{ ...S.td, textAlign: 'right', color: v.is_breakout ? '#fbbf24' : 'rgba(255,255,255,0.7)', fontWeight: v.is_breakout ? 700 : 500 }}>
                {v.breakout_raw.toFixed(0)}{v.is_breakout && ' ★'}
              </td>
              <td style={{ ...S.td, textAlign: 'right' }}>
                <span style={{ ...S.categoryPill, background: CATEGORY_COLORS[v.category] + '22', color: CATEGORY_COLORS[v.category], borderColor: CATEGORY_COLORS[v.category] + '55' }}>{v.category}</span>
              </td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr><td colSpan={cols.length} style={{ ...S.td, textAlign: 'center', padding: 30, color: 'rgba(255,255,255,0.3)' }}>No videos to score yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Detail panel
// ═══════════════════════════════════════════════════════════════════
function DetailPanel({ video, onClose, weights }) {
  const w = weights || weightsForRole('broad');
  const hint = nextActionHint(video);
  return (
    <div style={S.modalBackdrop} {...backdropDismiss(onClose)}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>
        <div style={S.modalHeader}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            {video.thumbnail_url && <img src={video.thumbnail_url} alt="" style={{ width: 160, height: 90, borderRadius: 6, objectFit: 'cover' }} />}
            <div>
              <div style={{ fontWeight: 700, fontSize: 17, color: '#fff', marginBottom: 4 }}>{video.title}</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>{formatDate(video.published_at)} · {formatNumber(video.total_views)} views</div>
              {video.url && <a href={video.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: colors.accentFg }}>Open on YouTube ↗</a>}
            </div>
          </div>
          <button onClick={onClose} style={S.closeBtn}>✕</button>
        </div>

        {/* Score summary */}
        <div style={S.scoreGrid}>
          <ScoreCard label="Stability" value={video.stability_score} color="#5b8fc7" subtitle="loyal audience engagement" />
          <ScoreCard label="Growth"    value={video.growth_score}    color="#22c55e" subtitle="reach to new viewers" />
          <ScoreCard label="Breakout"  value={video.breakout_raw}    color="#f59e0b" subtitle={video.is_breakout ? '★ qualified breakout' : 'gate not cleared'} />
        </div>

        {hint && <div style={S.hintBox}>{hint}</div>}

        {/* Component breakdown */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
          <ComponentList title="Stability components" weights={w.stability} indices={video.indices.stability} color="#5b8fc7" />
          <ComponentList title="Growth components" weights={w.growth} indices={video.indices.growth} color="#22c55e" />
        </div>

        {/* Purity check */}
        <div style={S.purityBox}>
          <span style={S.purityLabel}>New-to-returning ratio drift</span>
          <span style={{ fontWeight: 700, color: video.ratio_delta <= BREAKOUT_GATE.ratio_tolerance ? '#86efac' : '#fca5a5' }}>
            {(video.ratio_delta * 100).toFixed(0)}% from channel norm
            {video.ratio_delta > BREAKOUT_GATE.ratio_tolerance && ' ⚠'}
          </span>
        </div>

        <div style={S.purityHint}>
          {video.ratio_delta > BREAKOUT_GATE.ratio_tolerance
            ? 'Mix has skewed beyond ±25% of channel norm — purity-check fails. Counts as growth or stability, not breakout.'
            : 'Mix stayed within ±25% of channel norm — purity-check passes.'}
        </div>

        {/* Raw stats */}
        <details style={{ marginTop: 14 }}>
          <summary style={{ color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 12 }}>Raw underlying stats</summary>
          <div style={S.rawGrid}>
            <RawStat label="Watch time (hrs)" value={(video.watch_time_minutes / 60).toLocaleString(undefined, { maximumFractionDigits: 1 })} />
            <RawStat label="Avg view duration" value={formatDuration(video.avg_view_duration_seconds)} />
            <RawStat label="Engagement rate" value={(video.engagement_rate * 100).toFixed(2) + '%'} />
            <RawStat label="Sub conversion" value={(video.sub_conversion * 100).toFixed(2) + '%'} />
            <RawStat label="Subscribed views" value={formatNumber(video.subscribed_views)} />
            <RawStat label="New (unsub) views" value={formatNumber(video.new_viewer_volume)} />
            <RawStat label="New viewer %" value={(video.new_viewer_pct * 100).toFixed(1) + '%'} />
            <RawStat label="Algo traffic %" value={(video.algo_traffic_pct * 100).toFixed(1) + '%'} />
            <RawStat label="Trailing sample" value={video.trailing_sample_size + ' videos'} />
          </div>
        </details>
      </div>
    </div>
  );
}

function nextActionHint(v) {
  if (v.is_breakout) return '★ Qualified breakout. Pattern this. Map what drew new viewers AND why returning viewers went deep — that overlap is rare and worth replicating.';
  if (v.category === 'stability') return 'Strong with loyal core. Growth lane is the weak axis — for the next video consider thumbnail/title tactics that traveled outside subscribers (look at videos with high growth scores).';
  if (v.category === 'growth') return 'New viewers showed up. Now check if returning viewers stuck around — low stability means new arrivals did not convert into deeper engagement. Tighten format, slow openings, lean into what loyal viewers reward.';
  if (v.ratio_delta > BREAKOUT_GATE.ratio_tolerance) return 'Mix is drifting — viewer composition for this video diverged from channel norm by >25%. Worth asking whether this video is morphing the audience.';
  return 'Under both axes vs trailing-20 norm. Check trailing-12 underperformer cluster: if 3+ in a row, this is signal, not noise.';
}

// ═══════════════════════════════════════════════════════════════════
// Subcomponents + helpers
// ═══════════════════════════════════════════════════════════════════
function ScoreCard({ label, value, color, subtitle }) {
  return (
    <div style={{ ...S.scoreCard, borderColor: color + '55' }}>
      <div style={{ ...S.scoreLabel, color }}>{label}</div>
      <div style={S.scoreValue}>{value.toFixed(0)}</div>
      <div style={S.scoreSubtitle}>{subtitle}</div>
    </div>
  );
}

function ComponentList({ title, weights, indices, color }) {
  return (
    <div style={{ ...S.componentList, borderColor: color + '33' }}>
      <div style={{ ...S.componentTitle, color }}>{title}</div>
      {Object.entries(weights).map(([key, weight]) => {
        const idx = indices[key] || 0;
        return (
          <div key={key} style={S.componentRow}>
            <span style={S.componentKey}>{key.replace(/_/g, ' ')}</span>
            <span style={S.componentWeight}>×{(weight * 100).toFixed(0)}%</span>
            <div style={S.componentBar}>
              <div style={{ ...S.componentBarInner, width: `${Math.min(100, idx)}%`, background: color }} />
            </div>
            <span style={S.componentIdx}>{idx.toFixed(0)}</span>
          </div>
        );
      })}
    </div>
  );
}

function RawStat({ label, value }) {
  return (
    <div style={S.rawStat}>
      <div style={S.rawStatLabel}>{label}</div>
      <div style={S.rawStatValue}>{value}</div>
    </div>
  );
}

function formatNumber(n) {
  if (n == null || isNaN(n)) return '—';
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return Math.round(n).toLocaleString();
}
function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function formatDuration(s) {
  if (!s) return '0:00';
  const mm = Math.floor(s / 60);
  const ss = String(Math.round(s % 60)).padStart(2, '0');
  return `${mm}:${ss}`;
}

// ═══════════════════════════════════════════════════════════════════
// Growth / Stability KPI sections
// ═══════════════════════════════════════════════════════════════════
// Per-role LONG-FORM tile ordering. Metrics come from per-video yt_video_daily
// (content_type='video'), so every tile here is genuinely long-form-only. Traffic
// mix + rising search terms are channel-wide (all formats) and live in ContextStrip,
// NOT here. `impressions`/`ctr` read the format-split analytics_youtube scorecard.
const LONG_GROWTH_TILES = {
  broad: [
    { metric: 'new_pct', label: 'New-viewer share', fmt: 'pct' },
    { metric: 'new_volume', label: 'New-viewer volume', fmt: 'num' },
    { metric: 'subs_per_video', label: 'Subs gained / video', fmt: 'num1', noSpark: true },
    { metric: 'subs_per_1k', label: 'Subs per 1k views', fmt: 'num1' },
    { kind: 'impressions' },
  ],
  niche: [
    { metric: 'subs_per_video', label: 'Subs gained / video', fmt: 'num1', noSpark: true },
    { metric: 'subs_per_1k', label: 'Subs per 1k views', fmt: 'num1' },
    { metric: 'views', label: 'Views (window)', fmt: 'num' },
    { kind: 'paired', label: 'New + Returning viewers', a: 'new_volume', b: 'returning_volume' },
    { kind: 'impressions' },
  ],
};
const LONG_STABILITY_TILES = {
  broad: [
    { metric: 'avd', label: 'Avg view duration', fmt: 'sec' },
    { metric: 'apv', label: 'Avg % viewed', fmt: 'pctRaw' },
    { metric: 'returning_pct', label: 'Returning-viewer mix', fmt: 'pct' },
    { metric: 'engagement', label: 'Engagement / view', fmt: 'pct' },
    { kind: 'ctr' },
  ],
  niche: [
    { metric: 'avd', label: 'Avg view duration', fmt: 'sec' },
    { metric: 'apv', label: 'Avg % viewed', fmt: 'pctRaw' },
    { metric: 'returning_pct', label: 'Returning-viewer strength', fmt: 'pct' },
    { metric: 'engagement', label: 'Engagement / view', fmt: 'pct' },
    { kind: 'ctr' },
  ],
};
// Genuinely not exposed by the YouTube Analytics API v2 — rendered as greyed chips
// so the gap is explicit. END_SCREEN exists only as a traffic source (views), not
// a click/CTR metric; per-second/intro retention curves aren't in the API at all.
const UNAVAILABLE_STABILITY = ['Per-second retention curve', 'Intro (30s) retention', 'End-screen CTR'];

function fmtVal(fmt, v) {
  if (v == null || isNaN(v)) return '—';
  switch (fmt) {
    case 'pct': return (v * 100).toFixed(1) + '%';   // fraction 0-1
    case 'pctRaw': return v.toFixed(1) + '%';         // already a percent 0-100
    case 'sec': return formatDuration(v);
    case 'num1': return Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 });
    default: return formatNumber(v);
  }
}
function fmtDelta(fmt, cur, prev) {
  if (cur == null || prev == null || isNaN(cur) || isNaN(prev)) return null;
  if (fmt === 'pct') { const d = (cur - prev) * 100; return { text: (d >= 0 ? '+' : '') + d.toFixed(1) + 'pp', up: d >= 0 }; }
  if (fmt === 'pctRaw') { const d = cur - prev; return { text: (d >= 0 ? '+' : '') + d.toFixed(1) + 'pp', up: d >= 0 }; }
  if (fmt === 'sec') { const d = cur - prev; return { text: (d >= 0 ? '+' : '') + Math.round(d) + 's', up: d >= 0 }; }
  if (prev === 0) { return cur === 0 ? null : { text: 'new', up: cur > 0 }; }
  const d = ((cur - prev) / Math.abs(prev)) * 100;
  return { text: (d >= 0 ? '+' : '') + d.toFixed(0) + '%', up: d >= 0 };
}

function KpiSection({ icon, title, subtitle, tiles, kpis, color, loading, unavailable }) {
  return (
    <div style={{ ...S.section, borderColor: color + '30' }}>
      <div style={S.sectionHead}>
        <span style={S.sectionTitle}><span style={{ marginRight: 8 }}>{icon}</span>{title}</span>
        <span style={S.sectionSub}>{subtitle}</span>
      </div>
      {loading && !kpis ? (
        <div style={S.kpiGrid}>{[0, 1, 2, 3].map(i => <Skeleton key={i} height={96} radius={10} />)}</div>
      ) : (
        <div style={S.kpiGrid}>
          {tiles.map((t, i) => <KPITile key={t.metric || t.kind || i} tile={t} kpis={kpis} color={color} />)}
        </div>
      )}
      {unavailable && unavailable.length > 0 && (
        <div style={S.unavailRow}>
          {unavailable.map(u => (
            <span key={u} style={S.unavailChip} title="Not exposed by the YouTube Analytics API v2">{u} · not tracked</span>
          ))}
        </div>
      )}
    </div>
  );
}

function KPITile({ tile, kpis, color }) {
  if (tile.kind === 'impressions' || tile.kind === 'ctr') return <ImpressionsTile kpis={kpis} mode={tile.kind} />;
  if (tile.kind === 'risingTerms') return <RisingTermsTile terms={kpis && kpis.risingTerms} />;
  if (tile.kind === 'paired') return <PairedTile kpis={kpis} tile={tile} />;
  const m = kpis && kpis.metrics ? kpis.metrics[tile.metric] : null;
  const delta = m ? fmtDelta(tile.fmt, m.value, m.prev) : null;
  const spark = !tile.noSpark && m && m.series && m.series.length > 1;
  return (
    <div style={S.kpiTile}>
      <div style={S.kpiLabel}>{tile.label}</div>
      <div style={S.kpiValueRow}>
        <span style={S.kpiValue}>{fmtVal(tile.fmt, m ? m.value : null)}</span>
        {spark && <Sparkline data={m.series} color={color} width={72} height={24} />}
      </div>
      {delta
        ? <span style={{ ...S.kpiDelta, color: delta.up ? '#4ade80' : '#f87171' }}>{delta.text}<span style={S.kpiDeltaTag}> vs prior {KPI_WINDOW}d</span></span>
        : <span style={S.kpiDeltaMuted}>no prior-window data</span>}
    </div>
  );
}

function ImpressionsTile({ kpis, mode }) {
  const imp = kpis ? kpis.impressions : null;
  const label = mode === 'ctr' ? 'Impressions CTR' : 'Impressions + CTR';
  if (!imp) {
    return (
      <div style={{ ...S.kpiTile, ...S.kpiTileStale }}>
        <div style={S.kpiLabel}>{label}</div>
        <div style={S.kpiValueMuted}>No CSV yet</div>
        <span style={S.kpiDeltaMuted}>Upload Studio CSV to populate</span>
      </div>
    );
  }
  const asOf = imp.asOf ? formatDate(imp.asOf) : null;
  return (
    <div style={{ ...S.kpiTile, ...S.kpiTileStale }}>
      <div style={S.kpiLabel}>{label}</div>
      <div style={S.kpiValueRow}>
        <span style={S.kpiValue}>{mode === 'ctr' ? imp.ctr.toFixed(1) + '%' : formatNumber(imp.impressions)}</span>
        {mode !== 'ctr' && <span style={S.kpiSecondary}>{imp.ctr.toFixed(1)}% CTR</span>}
      </div>
      <span style={S.kpiStaleTag}>⚠ lifetime · as of {asOf || 'last CSV'}</span>
    </div>
  );
}

function RisingTermsTile({ terms }) {
  const list = terms || [];
  return (
    <div style={{ ...S.kpiTile, ...S.kpiTileWide }}>
      <div style={S.kpiLabel}>Top rising search terms</div>
      {list.length === 0 ? (
        <div style={S.kpiValueMuted}>No search-term data</div>
      ) : (
        <div style={S.termList}>
          {list.map(t => (
            <div key={t.term} style={S.termRow}>
              <span style={S.termName}>{t.term}</span>
              <span style={S.termViews}>{formatNumber(t.views)}</span>
              <span style={{ ...S.termDelta, color: t.delta >= 0 ? '#4ade80' : '#f87171' }}>{t.delta >= 0 ? '+' : ''}{formatNumber(t.delta)}</span>
            </div>
          ))}
        </div>
      )}
      <span style={S.kpiDeltaMuted}>views vs prior {KPI_WINDOW}d</span>
    </div>
  );
}

function PairedTile({ kpis, tile }) {
  const a = kpis && kpis.metrics ? kpis.metrics[tile.a] : null;
  const b = kpis && kpis.metrics ? kpis.metrics[tile.b] : null;
  return (
    <div style={{ ...S.kpiTile, ...S.kpiTileWide }}>
      <div style={S.kpiLabel}>{tile.label}</div>
      <div style={S.pairRow}>
        <div style={S.pairCol}>
          <span style={S.pairTag}>New (unsub)</span>
          <span style={S.kpiValue}>{formatNumber(a ? a.value : null)}</span>
          {a && a.series && a.series.length > 1 && <Sparkline data={a.series} color="#22c55e" width={84} height={22} />}
        </div>
        <div style={S.pairCol}>
          <span style={S.pairTag}>Returning (sub)</span>
          <span style={S.kpiValue}>{formatNumber(b ? b.value : null)}</span>
          {b && b.series && b.series.length > 1 && <Sparkline data={b.series} color="#5b8fc7" width={84} height={22} />}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Channel-wide context strip (traffic mix + rising terms — all formats)
// ═══════════════════════════════════════════════════════════════════
const CONTEXT_TRAFFIC = [
  { metric: 'search_share', label: 'Search' },
  { metric: 'suggested_share', label: 'Suggested' },
  { metric: 'browse_suggested_share', label: 'Browse+Sugg' },
  { metric: 'playlist_endscreen_share', label: 'Playlist+End' },
];
function ContextStrip({ kpis, loading }) {
  return (
    <div style={S.contextStrip}>
      <div style={S.contextHead}>
        <span style={S.contextTitle}>Channel context</span>
        <span style={S.contextBadge}>whole channel · all formats · traffic can’t be format-split (per-video traffic API is empty)</span>
      </div>
      <div style={S.contextBody}>
        <div style={S.contextTraffic}>
          {CONTEXT_TRAFFIC.map(t => {
            const m = kpis && kpis.metrics ? kpis.metrics[t.metric] : null;
            const d = m ? fmtDelta('pct', m.value, m.prev) : null;
            return (
              <div key={t.metric} style={S.contextMetric}>
                <span style={S.contextMetricLabel}>{t.label}</span>
                <span style={S.contextMetricVal}>{fmtVal('pct', m ? m.value : null)}</span>
                {m && m.series && m.series.length > 1 && <Sparkline data={m.series} color="#8fb4d8" width={64} height={18} />}
                {d && <span style={{ fontSize: 10, fontWeight: 700, color: d.up ? '#4ade80' : '#f87171' }}>{d.text}</span>}
              </div>
            );
          })}
        </div>
        <div style={S.contextTerms}>
          <span style={S.contextMetricLabel}>Top rising search terms</span>
          {loading && !kpis ? <Skeleton height={16} /> : (
            (kpis && kpis.risingTerms && kpis.risingTerms.length > 0)
              ? kpis.risingTerms.slice(0, 4).map(t => (
                <div key={t.term} style={S.termRow}>
                  <span style={S.termName}>{t.term}</span>
                  <span style={{ ...S.termDelta, color: t.delta >= 0 ? '#4ade80' : '#f87171' }}>{t.delta >= 0 ? '+' : ''}{formatNumber(t.delta)}</span>
                </div>
              ))
              : <span style={S.kpiDeltaMuted}>No search-term data</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Short-form: cross-platform reach summary
// ═══════════════════════════════════════════════════════════════════
const SF_PLATFORMS = [
  { key: 'youtube', label: 'YT Shorts', color: '#ff0000' },
  { key: 'tiktok', label: 'TikTok', color: '#69C9D0' },
  { key: 'instagram', label: 'IG Reels', color: '#E1306C' },
  { key: 'facebook', label: 'FB Reels', color: '#1877F2' },
];
function CrossPlatformSummary({ data }) {
  if (!data) return <div style={S.section}><Skeleton height={70} /></div>;
  const views = {
    youtube: data.yt.views || 0,
    tiktok: data.platforms.tiktok.views || 0,
    instagram: data.platforms.instagram.views || 0,
    facebook: data.platforms.facebook.views || 0,
  };
  const prevViews = {
    youtube: data.yt.prevViews || 0,
    tiktok: data.platforms.tiktok.prev.views || 0,
    instagram: data.platforms.instagram.prev.views || 0,
    facebook: data.platforms.facebook.prev.views || 0,
  };
  const totalViews = Object.values(views).reduce((s, v) => s + v, 0);
  const totalPrev = Object.values(prevViews).reduce((s, v) => s + v, 0);
  const totalFollows = Object.values(data.follows || {}).reduce((s, v) => s + v, 0);
  return (
    <div style={{ ...S.section, borderColor: '#f59e0b40' }}>
      <div style={S.sectionHead}>
        <span style={S.sectionTitle}>📡 Short-form reach across platforms</span>
        <span style={S.sectionSub}>last {data.window}d · views + follower growth, all platforms</span>
      </div>
      <div style={S.reachRow}>
        <div style={S.reachHero}>
          <div style={S.kpiLabel}>Total short-form views</div>
          <div style={S.reachHeroVal}>{formatNumber(totalViews)}</div>
          <div style={S.reachHeroSub}>
            <DeltaPct cur={totalViews} prev={totalPrev} /> · +{formatNumber(totalFollows)} followers
          </div>
        </div>
        {SF_PLATFORMS.map(p => (
          <div key={p.key} style={S.reachCol}>
            <span style={{ ...S.reachDot, background: p.color }} />
            <span style={S.reachColLabel}>{p.label}</span>
            <span style={S.reachColVal}>{views[p.key] > 0 ? formatNumber(views[p.key]) : '—'}</span>
            <span style={S.reachColSub}>{(data.follows && data.follows[p.key]) ? '+' + formatNumber(data.follows[p.key]) + ' foll' : ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Short-form: four-family × platform scorecard (family rows × platform cols)
// ═══════════════════════════════════════════════════════════════════
const FAMILIES = [
  { key: 'hook', label: 'Hook', sub: 'scroll-stop' },
  { key: 'hold', label: 'Hold', sub: 'completion · avg watch', hero: true },
  { key: 'amplify', label: 'Amplify', sub: 'shares · saves / view' },
  { key: 'convert', label: 'Convert', sub: 'follows / 1k views' },
];
// Per-channel YT Shorts four-family card (one vertical column of families).
// Metrics come from that channel's formatKpis.short: completion=apv, avg watch=avd,
// shares/view, follows/1k=subs_per_1k. Hook is greyed (no per-video scroll-stop);
// saves is greyed (content_metrics.saves is uniformly 0).
function ShortsFamilyCard({ metrics, loading, shortsCount }) {
  const val = (k) => (metrics && metrics[k] ? metrics[k].value : null);
  const cell = (fam) => {
    if (!metrics) return { text: loading ? '…' : '—', tone: 'muted' };
    if (fam === 'hook') return { text: 'not tracked', tone: 'na', note: 'no per-video scroll-stop metric' };
    if (fam === 'hold') return { text: `${(val('apv') || 0).toFixed(1)}% · ${formatDuration(val('avd') || 0)}`, tone: 'real' };
    if (fam === 'amplify') return { text: `${((val('shares_per_view') || 0) * 1000).toFixed(2)}/1k shares`, tone: 'real', note: 'saves n/a (not populated)' };
    if (fam === 'convert') return { text: `${(val('subs_per_1k') || 0).toFixed(2)} follows/1k`, tone: 'real' };
    return { text: '—', tone: 'muted' };
  };
  return (
    <div style={{ ...S.section, marginBottom: 14 }}>
      <div style={S.sectionHead}>
        <span style={S.sectionTitle}>🎯 Shorts families</span>
        <span style={S.sectionSub}>{shortsCount} Shorts · Hold is the hero</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {FAMILIES.map(fam => {
          const c = cell(fam.key);
          const color = c.tone === 'real' ? '#e7ebf2' : c.tone === 'na' ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.4)';
          return (
            <div key={fam.key} style={{ ...S.famRow, ...(fam.hero ? S.famRowHero : {}) }}>
              <div style={S.famLabel}>
                <div style={{ fontWeight: 700, fontSize: 13, color: fam.hero ? '#fbbf24' : '#fff' }}>{fam.label}{fam.hero ? ' ★' : ''}</div>
                <div style={S.scoreTdSub}>{fam.sub}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ color, fontWeight: c.tone === 'real' ? 800 : 500, fontSize: 15, fontStyle: c.tone === 'na' ? 'italic' : 'normal', fontVariantNumeric: 'tabular-nums' }}>{c.text}</div>
                {c.note && <div style={S.scoreCellNote}>{c.note}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Colored "▲ N% vs prior" delta. `points=true` renders a percentage-point
// change (for rate metrics) instead of a relative %.
function DeltaPct({ cur, prev, points }) {
  if (cur == null || prev == null || prev === 0) return <span style={S.deltaFlat}>—</span>;
  const diff = points ? (cur - prev) : ((cur - prev) / prev) * 100;
  const up = diff > 0.05, down = diff < -0.05;
  const color = up ? '#4ade80' : down ? '#f87171' : 'rgba(255,255,255,0.4)';
  const arrow = up ? '▲' : down ? '▼' : '·';
  return (
    <span style={{ ...S.delta, color }}>
      {arrow} {Math.abs(diff).toFixed(points ? 1 : 0)}{points ? 'pp' : '%'}
      <span style={S.deltaTag}> vs prior</span>
    </span>
  );
}

function fmtPct(v) { return v == null ? '—' : `${v.toFixed(1)}%`; }

// Per-platform KPI tiles. Reflects what Metricool actually returns for these
// accounts (probed 2026-07-22): only IG exposes reach + engaged accounts, so
// TikTok/FB fall back to a likes/interactions-per-view engagement rate.
function platformTiles(key, d) {
  const rate = (num, den) => (den > 0 ? (num / den) * 100 : null);
  if (key === 'instagram') {
    return [
      { label: 'Views', value: formatNumber(d.views), cur: d.views, prev: d.prev.views },
      { label: 'Reach', value: formatNumber(d.reach), cur: d.reach, prev: d.prev.reach },
      { label: 'Engaged accts', value: formatNumber(d.engaged), cur: d.engaged, prev: d.prev.engaged },
      { label: 'Eng. rate', value: fmtPct(rate(d.engaged, d.reach)), sub: 'engaged / reach', ratio: true, cur: rate(d.engaged, d.reach), prev: rate(d.prev.engaged, d.prev.reach) },
    ];
  }
  if (key === 'facebook') {
    return [
      { label: 'Views', value: formatNumber(d.views), cur: d.views, prev: d.prev.views },
      { label: 'Interactions', value: formatNumber(d.likes), cur: d.likes, prev: d.prev.likes },
      { label: 'Eng. rate', value: fmtPct(rate(d.likes, d.views)), sub: 'interactions / views', ratio: true, cur: rate(d.likes, d.views), prev: rate(d.prev.likes, d.prev.views) },
    ];
  }
  // tiktok
  return [
    { label: 'Views', value: formatNumber(d.views), cur: d.views, prev: d.prev.views },
    { label: 'Likes', value: formatNumber(d.likes), cur: d.likes, prev: d.prev.likes },
    { label: 'Eng. rate', value: fmtPct(rate(d.likes, d.views)), sub: 'likes / views', ratio: true, cur: rate(d.likes, d.views), prev: rate(d.prev.likes, d.prev.views) },
  ];
}

const PLATFORM_NOTE = {
  tiktok: 'account-level · reach & per-post not exposed by TikTok API',
  instagram: 'account-level · reach + engaged accounts from Metricool',
  facebook: 'account-level · reach not exposed by FB page API',
};

// Stacked full-width scorecard for a non-YT platform (TikTok / IG / FB).
// Account/day metrics only — real Views + platform-specific engagement + follower
// growth, each with a vs-prior-window delta, plus a 30d views sparkline.
function PlatformPanel({ platform, data }) {
  const key = platform.key;
  const d = data && data.platforms ? data.platforms[key] : null;
  const follows = data && data.follows ? (data.follows[key] || 0) : 0;
  const followsPrev = data && data.followsPrev ? (data.followsPrev[key] || 0) : 0;
  const tiles = d ? platformTiles(key, d) : [];
  const series = d && d.series ? d.series.map((p) => p.views) : [];
  return (
    <div style={{ ...S.section, borderColor: platform.color + '40', marginBottom: 12 }}>
      <div style={S.sectionHead}>
        <span style={S.sectionTitle}><span style={{ ...S.reachDot, background: platform.color, marginRight: 8 }} />{platform.label}</span>
        <span style={S.sectionSub}>{PLATFORM_NOTE[key] || 'account-level'} · last {data ? data.window : 30}d</span>
      </div>
      {!d ? <Skeleton height={90} /> : (
        <div style={S.platGrid}>
          <div style={S.platTiles}>
            {tiles.map((t) => (
              <div key={t.label} style={S.platTile}>
                <div style={S.kpiLabel}>{t.label}</div>
                <div style={S.platTileVal}>{t.value}</div>
                <DeltaPct cur={t.cur} prev={t.prev} points={t.ratio} />
                {t.sub && <div style={S.platTileSub}>{t.sub}</div>}
              </div>
            ))}
            <div style={S.platTile}>
              <div style={S.kpiLabel}>Follower growth</div>
              <div style={{ ...S.platTileVal, color: follows > 0 ? '#4ade80' : follows < 0 ? '#f87171' : '#fff' }}>{follows > 0 ? '+' : ''}{formatNumber(follows)}</div>
              <DeltaPct cur={follows} prev={followsPrev} />
            </div>
          </div>
          <div style={S.platSpark}>
            <div style={S.kpiLabel}>Views · {data ? data.window : 30}d</div>
            {series.length > 1
              ? <Sparkline data={series} color={platform.color} width={176} height={40} />
              : <div style={S.sparkEmpty}>not enough data</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════════════════════════════
const S = {
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 },
  headerLeft: { display: 'flex', flexDirection: 'column', gap: 2 },
  title: { fontSize: 18, fontWeight: 700, color: '#fff' },
  subtitle: { fontSize: 12, color: 'rgba(255,255,255,0.45)' },
  channelTabs: { display: 'flex', gap: 4, padding: 4, background: 'rgba(255,255,255,0.04)', borderRadius: 10 },
  channelTab: { padding: '7px 14px', background: 'transparent', border: 'none', borderRadius: 7, color: 'rgba(255,255,255,0.5)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  channelTabActive: { background: 'rgba(91, 143, 199,0.18)', color: '#8fb4d8' },

  // Two-column side-by-side layout (stacks to 1 col on narrow widths)
  columnsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 16, alignItems: 'start' },
  column: { minWidth: 0 },
  columnHead: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid rgba(255,255,255,0.08)' },
  columnDot: { width: 12, height: 12, borderRadius: '50%', flexShrink: 0 },
  columnName: { fontSize: 16, fontWeight: 800, color: '#fff' },
  columnRole: { fontSize: 11, color: 'rgba(255,255,255,0.45)' },
  drillToggle: { width: '100%', textAlign: 'left', padding: '9px 12px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', marginBottom: 10 },
  platformStack: { marginTop: 4 },
  famRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '10px 12px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10 },
  famRowHero: { background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.22)' },
  famLabel: { display: 'flex', flexDirection: 'column', gap: 1 },
  // Non-YT platform scorecard: tile grid + right-side sparkline
  platGrid: { display: 'flex', gap: 16, alignItems: 'stretch', flexWrap: 'wrap' },
  platTiles: { flex: 1, minWidth: 240, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 },
  platTile: { display: 'flex', flexDirection: 'column', gap: 3, padding: '10px 12px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10 },
  platTileVal: { fontSize: 21, fontWeight: 800, color: '#fff', fontVariantNumeric: 'tabular-nums', lineHeight: 1.15 },
  platTileSub: { fontSize: 10, color: 'rgba(255,255,255,0.35)' },
  platSpark: { width: 200, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center', padding: '10px 12px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10 },
  sparkEmpty: { fontSize: 11, color: 'rgba(255,255,255,0.3)', fontStyle: 'italic', padding: '10px 0' },
  delta: { fontSize: 11, fontWeight: 700, fontVariantNumeric: 'tabular-nums', display: 'inline-flex', alignItems: 'baseline', gap: 3 },
  deltaFlat: { fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.3)' },
  deltaTag: { fontSize: 9, fontWeight: 500, color: 'rgba(255,255,255,0.3)' },

  // Growth / Stability KPI sections
  section: { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 16, marginBottom: 14 },
  sectionHead: { display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12, flexWrap: 'wrap' },
  sectionTitle: { fontSize: 15, fontWeight: 800, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.5px' },
  sectionSub: { fontSize: 11, color: 'rgba(255,255,255,0.4)' },
  kpiGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 10 },
  kpiTile: { display: 'flex', flexDirection: 'column', gap: 6, padding: 12, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, minHeight: 92 },
  kpiTileWide: { gridColumn: 'span 2' },
  kpiTileStale: { background: 'rgba(245,158,11,0.04)', border: '1px solid rgba(245,158,11,0.18)' },
  kpiLabel: { fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.4px' },
  kpiValueRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  kpiValue: { fontSize: 22, fontWeight: 800, color: '#fff', fontVariantNumeric: 'tabular-nums' },
  kpiValueMuted: { fontSize: 15, fontWeight: 600, color: 'rgba(255,255,255,0.35)' },
  kpiSecondary: { fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.55)', fontVariantNumeric: 'tabular-nums' },
  kpiDelta: { fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums' },
  kpiDeltaTag: { fontSize: 10, fontWeight: 500, color: 'rgba(255,255,255,0.35)' },
  kpiDeltaMuted: { fontSize: 11, color: 'rgba(255,255,255,0.3)' },
  kpiStaleTag: { fontSize: 10, color: '#fbbf24', fontWeight: 600 },
  termList: { display: 'flex', flexDirection: 'column', gap: 4 },
  termRow: { display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 10, alignItems: 'center' },
  termName: { fontSize: 12, color: 'rgba(255,255,255,0.8)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  termViews: { fontSize: 12, color: 'rgba(255,255,255,0.55)', fontVariantNumeric: 'tabular-nums' },
  termDelta: { fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums', minWidth: 44, textAlign: 'right' },
  pairRow: { display: 'flex', gap: 16 },
  pairCol: { display: 'flex', flexDirection: 'column', gap: 2, flex: 1 },
  pairTag: { fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.4px' },
  unavailRow: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 },
  unavailChip: { fontSize: 10, color: 'rgba(255,255,255,0.35)', background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.12)', borderRadius: 20, padding: '4px 10px' },

  // View switcher
  viewTabs: { display: 'flex', gap: 4, padding: 4, background: 'rgba(255,255,255,0.04)', borderRadius: 10 },
  viewTab: { padding: '7px 16px', background: 'transparent', border: 'none', borderRadius: 7, color: 'rgba(255,255,255,0.5)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
  viewTabActive: { background: 'rgba(245,158,11,0.16)', color: '#fbbf24' },

  // Channel-wide context strip
  contextStrip: { background: 'rgba(143,180,216,0.03)', border: '1px solid rgba(143,180,216,0.14)', borderRadius: 12, padding: 14, marginBottom: 14 },
  contextHead: { display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10, flexWrap: 'wrap' },
  contextTitle: { fontSize: 13, fontWeight: 700, color: '#fff' },
  contextBadge: { fontSize: 10, color: '#8fb4d8', background: 'rgba(143,180,216,0.1)', border: '1px solid rgba(143,180,216,0.25)', borderRadius: 20, padding: '3px 9px' },
  contextBody: { display: 'grid', gridTemplateColumns: 'minmax(280px, 2fr) minmax(200px, 1fr)', gap: 16, alignItems: 'start' },
  contextTraffic: { display: 'flex', gap: 14, flexWrap: 'wrap' },
  contextMetric: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 78 },
  contextMetricLabel: { fontSize: 10, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.4px', fontWeight: 700 },
  contextMetricVal: { fontSize: 16, fontWeight: 800, color: '#fff', fontVariantNumeric: 'tabular-nums' },
  contextTerms: { display: 'flex', flexDirection: 'column', gap: 3 },

  // Cross-platform reach
  reachRow: { display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'stretch' },
  reachHero: { flex: '1 1 180px', padding: 12, borderRadius: 10, background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)' },
  reachHeroVal: { fontSize: 28, fontWeight: 800, color: '#fff', fontVariantNumeric: 'tabular-nums' },
  reachHeroSub: { fontSize: 12, color: '#4ade80', fontWeight: 700 },
  reachCol: { flex: '1 1 110px', display: 'flex', flexDirection: 'column', gap: 2, padding: 12, borderRadius: 10, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' },
  reachDot: { display: 'inline-block', width: 8, height: 8, borderRadius: '50%' },
  reachColLabel: { fontSize: 11, color: 'rgba(255,255,255,0.6)', fontWeight: 700 },
  reachColVal: { fontSize: 18, fontWeight: 800, color: '#fff', fontVariantNumeric: 'tabular-nums' },
  reachColSub: { fontSize: 10, color: 'rgba(255,255,255,0.4)' },

  // Family scorecard table
  scoreTableScroll: { overflowX: 'auto' },
  scoreTable: { width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 640 },
  scoreTh: { padding: '8px 12px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.55)', borderBottom: '1px solid rgba(255,255,255,0.08)', whiteSpace: 'nowrap' },
  scoreRowHero: { background: 'rgba(245,158,11,0.05)' },
  scoreTdLabel: { padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)', minWidth: 140 },
  scoreTdSub: { fontSize: 10, color: 'rgba(255,255,255,0.4)' },
  scoreTd: { padding: '10px 12px', textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.04)', fontVariantNumeric: 'tabular-nums' },
  scoreCellNote: { fontSize: 9, color: 'rgba(255,255,255,0.3)', marginTop: 2 },
  scoreFootnote: { marginTop: 10, fontSize: 10, color: 'rgba(255,255,255,0.35)', lineHeight: 1.4 },

  mixCard: { background: 'rgba(91, 143, 199,0.04)', border: '1px solid rgba(91, 143, 199,0.15)', borderRadius: 12, padding: 14, marginBottom: 14 },
  mixHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 },
  mixTitle: { fontSize: 13, fontWeight: 700, color: '#fff' },
  mixSubtitle: { fontSize: 11, color: 'rgba(255,255,255,0.4)' },
  mixBars: { display: 'flex', flexDirection: 'column', gap: 8 },
  mixItem: { display: 'grid', gridTemplateColumns: '160px 1fr 120px', gap: 12, alignItems: 'center' },
  mixLabel: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'rgba(255,255,255,0.7)', textTransform: 'capitalize' },
  mixBarOuter: { height: 8, background: 'rgba(255,255,255,0.04)', borderRadius: 4, overflow: 'hidden' },
  mixBarInner: { height: '100%', borderRadius: 4 },
  mixCount: { fontSize: 12, color: '#fff', fontVariantNumeric: 'tabular-nums', textAlign: 'right' },

  card: { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: 18, marginBottom: 16, position: 'relative' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: 700, color: '#fff' },
  loadingOverlay: { position: 'absolute', top: 8, right: 12, color: 'rgba(255,255,255,0.4)', fontSize: 11 },

  legend: { display: 'flex', gap: 12 },
  legendItem: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'rgba(255,255,255,0.6)', textTransform: 'capitalize' },
  legendDot: { width: 8, height: 8, borderRadius: '50%' },

  scatterTooltip: { position: 'absolute', top: 12, right: 12, background: 'rgba(18,18,31,0.95)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '10px 14px', minWidth: 220, pointerEvents: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.4)' },
  tipTitle: { fontSize: 12, color: '#fff', fontWeight: 600, marginBottom: 4, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  tipMeta: { fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 4 },
  tipScores: { fontSize: 11, color: 'rgba(255,255,255,0.7)', fontVariantNumeric: 'tabular-nums' },

  tableScroll: { overflow: 'auto', maxHeight: 600, borderRadius: 8 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { padding: '10px 14px', fontWeight: 600, fontSize: 11, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid rgba(255,255,255,0.08)', position: 'sticky', top: 0, background: '#161d2b', zIndex: 1, whiteSpace: 'nowrap', userSelect: 'none' },
  td: { padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.75)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
  thumb: { width: 64, height: 36, borderRadius: 4, objectFit: 'cover', flexShrink: 0 },

  categoryPill: { padding: '3px 9px', borderRadius: 12, fontSize: 11, fontWeight: 600, border: '1px solid', textTransform: 'capitalize', display: 'inline-block' },

  modalBackdrop: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 },
  modal: { background: '#0e1420', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, padding: 24, width: 'min(900px, 95vw)', maxHeight: '90vh', overflow: 'auto' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18, paddingBottom: 14, borderBottom: '1px solid rgba(255,255,255,0.06)' },
  closeBtn: { background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontFamily: 'inherit' },

  scoreGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 14 },
  scoreCard: { padding: 14, borderRadius: 10, background: 'rgba(255,255,255,0.02)', border: '1px solid', textAlign: 'center' },
  scoreLabel: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 },
  scoreValue: { fontSize: 36, fontWeight: 800, color: '#fff', fontVariantNumeric: 'tabular-nums' },
  scoreSubtitle: { fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 4 },

  hintBox: { padding: '10px 14px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 8, fontSize: 12, color: '#fde68a', lineHeight: 1.5 },

  componentList: { padding: 14, borderRadius: 10, background: 'rgba(255,255,255,0.02)', border: '1px solid' },
  componentTitle: { fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 },
  componentRow: { display: 'grid', gridTemplateColumns: '1fr 36px 1fr 36px', gap: 8, alignItems: 'center', marginBottom: 6 },
  componentKey: { fontSize: 11, color: 'rgba(255,255,255,0.7)' },
  componentWeight: { fontSize: 10, color: 'rgba(255,255,255,0.4)' },
  componentBar: { height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' },
  componentBarInner: { height: '100%', borderRadius: 3 },
  componentIdx: { fontSize: 11, color: '#fff', fontVariantNumeric: 'tabular-nums', textAlign: 'right' },

  purityBox: { marginTop: 14, padding: '10px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 },
  purityLabel: { color: 'rgba(255,255,255,0.6)' },
  purityHint: { marginTop: 6, fontSize: 11, color: 'rgba(255,255,255,0.4)', lineHeight: 1.4 },

  rawGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 10 },
  rawStat: { padding: 10, background: 'rgba(255,255,255,0.02)', borderRadius: 6 },
  rawStatLabel: { fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' },
  rawStatValue: { fontSize: 14, color: '#fff', fontWeight: 600, marginTop: 2, fontVariantNumeric: 'tabular-nums' },

  emptyCard: { background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.08)', borderRadius: 14, padding: 32, textAlign: 'center', marginBottom: 20 },
  emptyText: { color: 'rgba(255,255,255,0.4)', fontSize: 14, margin: 0 },
};
