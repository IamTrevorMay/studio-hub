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

const STABILITY_WEIGHTS = {
  returning_watch_time: 0.30,
  engagement_rate:      0.25,
  sub_conversion:       0.20,
  returning_view_pct:   0.15,
  avg_view_duration:    0.10,
};

const GROWTH_WEIGHTS = {
  new_viewer_volume:    0.30,
  new_viewer_pct:       0.20,
  new_sub_conversion:   0.20,
  new_viewer_retention: 0.15,
  algo_traffic_pct:     0.15,
};

const CATEGORY_COLORS = {
  breakout:        '#f59e0b',
  stability:       '#6366f1',
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

// ═══════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════
export default function ContentHealthDashboard({ accounts }) {
  const ytChannels = useMemo(
    () => (accounts || []).filter(a => a.platform === 'youtube'),
    [accounts]
  );

  const [activeChannelId, setActiveChannelId] = useState(null);
  useEffect(() => {
    if (!activeChannelId && ytChannels.length > 0) setActiveChannelId(ytChannels[0].id);
  }, [ytChannels, activeChannelId]);

  const [videos, setVideos] = useState([]); // scored video rows
  const [loading, setLoading] = useState(false);
  const [selectedVideoId, setSelectedVideoId] = useState(null);
  const fetchGenRef = useRef(0); // guards against a stale channel's fetch resolving last

  useEffect(() => {
    if (!activeChannelId) return;
    fetchAndScore();
    // eslint-disable-next-line
  }, [activeChannelId]);

  async function fetchAndScore() {
    const gen = ++fetchGenRef.current;
    setLoading(true);
    try {
      // Lifetime aggregate per video from yt_video_daily
      const { data: dailyRows } = await supabase
        .from('yt_video_daily')
        .select('video_id, views, watch_time_minutes, average_view_duration_seconds, subscribers_gained, likes, comments, shares')
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
        if (!dailyByVideo[id]) dailyByVideo[id] = { views: 0, watch_time_minutes: 0, avd_sum: 0, avd_n: 0, subs: 0, likes: 0, comments: 0, shares: 0 };
        const d = dailyByVideo[id];
        d.views += Number(r.views) || 0;
        d.watch_time_minutes += Number(r.watch_time_minutes) || 0;
        d.subs += Number(r.subscribers_gained) || 0;
        d.likes += Number(r.likes) || 0;
        d.comments += Number(r.comments) || 0;
        d.shares += Number(r.shares) || 0;
        // weighted avg view duration by views
        const avd = Number(r.average_view_duration_seconds) || 0;
        const v = Number(r.views) || 0;
        d.avd_sum += avd * v; d.avd_n += v;
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
        };
      });

      // Sort by published_at descending so we can compute trailing-20 norm
      raw.sort((a, b) => {
        const ad = a.published_at ? new Date(a.published_at).getTime() : 0;
        const bd = b.published_at ? new Date(b.published_at).getTime() : 0;
        return bd - ad;
      });

      // Compute trailing norms + scores
      const scored = raw.map((v, idx) => {
        // Trailing N videos = next N in array (newer is at index 0, so trailing = older)
        const trailing = raw.slice(idx + 1, idx + 1 + NORM_WINDOW);
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
          idx_returning_wt    * STABILITY_WEIGHTS.returning_watch_time +
          idx_engagement      * STABILITY_WEIGHTS.engagement_rate +
          idx_sub_conv        * STABILITY_WEIGHTS.sub_conversion +
          idx_returning_pct   * STABILITY_WEIGHTS.returning_view_pct +
          idx_avd             * STABILITY_WEIGHTS.avg_view_duration
        );

        const idx_new_vol      = computeIndex(v.new_viewer_volume,      meds.new_viewer_volume);
        const idx_new_pct      = computeIndex(v.new_viewer_pct,         meds.new_viewer_pct);
        const idx_new_sub_conv = computeIndex(v.new_sub_conversion,     meds.new_sub_conversion);
        const idx_new_ret      = computeIndex(v.new_viewer_retention,   meds.new_viewer_retention);
        const idx_algo         = computeIndex(v.algo_traffic_pct,       meds.algo_traffic_pct);

        const growth = (
          idx_new_vol      * GROWTH_WEIGHTS.new_viewer_volume +
          idx_new_pct      * GROWTH_WEIGHTS.new_viewer_pct +
          idx_new_sub_conv * GROWTH_WEIGHTS.new_sub_conversion +
          idx_new_ret      * GROWTH_WEIGHTS.new_viewer_retention +
          idx_algo         * GROWTH_WEIGHTS.algo_traffic_pct
        );

        const breakoutRaw = (stability * growth) / 100;
        const channelRatio = meds.new_to_returning_ratio || 0;
        // Same expression + same denominator floor as the channel median above,
        // so video and norm are computed identically (was unfloored → skewed
        // drift % for low-watch videos).
        const videoRatio = v.new_viewer_volume / Math.max(v.returning_watch_time / 60, 1);
        const ratioDelta = channelRatio > 0 ? Math.abs(videoRatio - channelRatio) / channelRatio : 0;
        const ratioPasses = ratioDelta <= BREAKOUT_GATE.ratio_tolerance;
        const isBreakout = stability >= BREAKOUT_GATE.stability
          && growth >= BREAKOUT_GATE.growth
          && ratioPasses;

        const category = isBreakout ? 'breakout' : categorize(stability, growth);

        return {
          ...v,
          stability_score: stability,
          growth_score: growth,
          breakout_raw: breakoutRaw,
          is_breakout: isBreakout,
          category,
          ratio_delta: ratioDelta,
          indices: {
            stability: {
              returning_watch_time: idx_returning_wt,
              engagement_rate: idx_engagement,
              sub_conversion: idx_sub_conv,
              returning_view_pct: idx_returning_pct,
              avg_view_duration: idx_avd,
            },
            growth: {
              new_viewer_volume: idx_new_vol,
              new_viewer_pct: idx_new_pct,
              new_sub_conversion: idx_new_sub_conv,
              new_viewer_retention: idx_new_ret,
              algo_traffic_pct: idx_algo,
            },
          },
          trailing_sample_size: trailing.length,
        };
      });

      // Only videos with at least 1 trailing sample for context (still show
      // others but mark "low confidence")
      if (gen !== fetchGenRef.current) return; // a newer channel switch superseded this fetch
      setVideos(scored);
    } catch (e) {
      console.error('Content Health fetch error:', e);
    } finally {
      if (gen === fetchGenRef.current) setLoading(false);
    }
  }

  // ── Channel mix card (rolling last 12 published videos) ──
  const channelMix = useMemo(() => {
    if (videos.length === 0) return null;
    const last12 = videos.slice(0, 12);
    const buckets = { stability: 0, growth: 0, breakout: 0, underperforming: 0 };
    for (const v of last12) buckets[v.category] = (buckets[v.category] || 0) + 1;
    const prev12 = videos.slice(12, 24);
    const prevBuckets = { stability: 0, growth: 0, breakout: 0, underperforming: 0 };
    for (const v of prev12) prevBuckets[v.category] = (prevBuckets[v.category] || 0) + 1;
    return { current: buckets, previous: prevBuckets, total: last12.length, prevTotal: prev12.length };
  }, [videos]);

  // ── Render ──
  if (ytChannels.length === 0) {
    return (
      <div style={S.emptyCard}>
        <p style={S.emptyText}>No YouTube channels connected.</p>
      </div>
    );
  }

  const selectedVideo = videos.find(v => v.video_id === selectedVideoId);

  return (
    <div>
      {/* Channel switcher */}
      <div style={S.header}>
        <div style={S.headerLeft}>
          <span style={S.title}>Content Health</span>
          <span style={S.subtitle}>Stability vs Growth scoring · trailing {NORM_WINDOW}-video norm</span>
        </div>
        <div style={S.channelTabs}>
          {ytChannels.map(c => (
            <button key={c.id} onClick={() => setActiveChannelId(c.id)}
              style={{ ...S.channelTab, ...(activeChannelId === c.id ? S.channelTabActive : {}) }}>
              {c.account_name}
            </button>
          ))}
        </div>
      </div>

      {/* Channel mix card */}
      {channelMix && <ChannelMixCard mix={channelMix} />}

      {/* Scatter plot */}
      <div style={S.card}>
        <div style={S.cardHeader}>
          <span style={S.cardTitle}>Stability × Growth — last {videos.length} videos</span>
          <div style={S.legend}>
            {Object.entries(CATEGORY_COLORS).map(([cat, color]) => (
              <span key={cat} style={S.legendItem}>
                <span style={{ ...S.legendDot, background: color }} />
                {cat}
              </span>
            ))}
          </div>
        </div>
        <ScatterPlot videos={videos} onSelect={setSelectedVideoId} />
        {loading && <div style={S.loadingOverlay}>Loading…</div>}
      </div>

      {/* Ranked table */}
      <div style={S.card}>
        <div style={S.cardHeader}>
          <span style={S.cardTitle}>All scored videos</span>
        </div>
        <RankedTable videos={videos} onSelect={setSelectedVideoId} />
      </div>

      {/* Detail modal */}
      {selectedVideo && (
        <DetailPanel video={selectedVideo} onClose={() => setSelectedVideoId(null)} />
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
function ScatterPlot({ videos, onSelect }) {
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
        <text x={PAD.left + plotW / 2} y={H - 14} textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="12">Stability Score →</text>
        <text x={16} y={PAD.top + plotH / 2} textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="12" transform={`rotate(-90 16 ${PAD.top + plotH / 2})`}>Growth Score →</text>

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
              <td style={{ ...S.td, textAlign: 'right', color: '#a5b4fc' }}>{v.stability_score.toFixed(0)}</td>
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
function DetailPanel({ video, onClose }) {
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
              {video.url && <a href={video.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#a5b4fc' }}>Open on YouTube ↗</a>}
            </div>
          </div>
          <button onClick={onClose} style={S.closeBtn}>✕</button>
        </div>

        {/* Score summary */}
        <div style={S.scoreGrid}>
          <ScoreCard label="Stability" value={video.stability_score} color="#6366f1" subtitle="loyal audience engagement" />
          <ScoreCard label="Growth"    value={video.growth_score}    color="#22c55e" subtitle="reach to new viewers" />
          <ScoreCard label="Breakout"  value={video.breakout_raw}    color="#f59e0b" subtitle={video.is_breakout ? '★ qualified breakout' : 'gate not cleared'} />
        </div>

        {hint && <div style={S.hintBox}>{hint}</div>}

        {/* Component breakdown */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
          <ComponentList title="Stability components" weights={STABILITY_WEIGHTS} indices={video.indices.stability} color="#6366f1" />
          <ComponentList title="Growth components" weights={GROWTH_WEIGHTS} indices={video.indices.growth} color="#22c55e" />
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
// Styles
// ═══════════════════════════════════════════════════════════════════
const S = {
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 },
  headerLeft: { display: 'flex', flexDirection: 'column', gap: 2 },
  title: { fontSize: 18, fontWeight: 700, color: '#fff' },
  subtitle: { fontSize: 12, color: 'rgba(255,255,255,0.45)' },
  channelTabs: { display: 'flex', gap: 4, padding: 4, background: 'rgba(255,255,255,0.04)', borderRadius: 10 },
  channelTab: { padding: '7px 14px', background: 'transparent', border: 'none', borderRadius: 7, color: 'rgba(255,255,255,0.5)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  channelTabActive: { background: 'rgba(99,102,241,0.18)', color: '#a5b4fc' },

  mixCard: { background: 'rgba(99,102,241,0.04)', border: '1px solid rgba(99,102,241,0.15)', borderRadius: 12, padding: 14, marginBottom: 14 },
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
  th: { padding: '10px 14px', fontWeight: 600, fontSize: 11, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid rgba(255,255,255,0.08)', position: 'sticky', top: 0, background: '#16162a', zIndex: 1, whiteSpace: 'nowrap', userSelect: 'none' },
  td: { padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.75)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
  thumb: { width: 64, height: 36, borderRadius: 4, objectFit: 'cover', flexShrink: 0 },

  categoryPill: { padding: '3px 9px', borderRadius: 12, fontSize: 11, fontWeight: 600, border: '1px solid', textTransform: 'capitalize', display: 'inline-block' },

  modalBackdrop: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 },
  modal: { background: '#0f0f1a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, padding: 24, width: 'min(900px, 95vw)', maxHeight: '90vh', overflow: 'auto' },
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
