// YouTube Studio Advanced replica.
//
// Designed to look + behave like the Advanced view inside YouTube Studio
// Analytics. Two key differences from Studio: this can aggregate across
// multiple channels (Studio is per-channel), and it lives inside our dark
// theme.
//
// Data sources:
//   • yt_video_daily  — per-video daily metrics (Content row pivot)
//   • yt_dim_*        — channel-level dimensional pivots
//   • yt_video_dim_*  — per-video dimensional pivots (drilldown only)
//
// Aggregation when multiple channels selected:
//   • Counts (views, watch time, subs, revenue, etc.) → sum
//   • Ratios (CTR, avg view duration, avg view %, CPM, RPM, viewer %)
//     → weighted average by an appropriate denominator (impressions, views,
//       playbacks)

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import backdropDismiss from '../lib/backdropDismiss';

// ═══════════════════════════════════════════════════════════════════
// Catalogs
// ═══════════════════════════════════════════════════════════════════

// Studio's dimensions. Each maps to a table + the column we group on.
// `table` is the channel-level table; `videoTable` is the per-video version
// (used in drilldown).
const DIMENSIONS = [
  { key: 'content',              label: 'Content',                    table: 'yt_video_daily',                 group: 'video_id',       isContent: true },
  { key: 'traffic_source',       label: 'Traffic source',             table: 'yt_dim_traffic_source',          videoTable: 'yt_video_dim_traffic_source',          group: 'dimension_value' },
  { key: 'external',             label: 'External traffic source',    table: 'yt_dim_external',                videoTable: 'yt_video_dim_external',                group: 'dimension_value' },
  { key: 'search_terms',         label: 'YouTube search terms',       table: 'yt_dim_search_terms',            videoTable: 'yt_video_dim_search_terms',            group: 'dimension_value' },
  { key: 'geography',            label: 'Geography',                  table: 'yt_dim_geography',               videoTable: 'yt_video_dim_geography',               group: 'dimension_value' },
  { key: 'city',                 label: 'Cities',                     table: 'yt_dim_city',                    videoTable: 'yt_video_dim_city',                    group: 'dimension_value' },
  { key: 'subtitles',            label: 'Subtitles and CC',           table: 'yt_dim_subtitles',               videoTable: 'yt_video_dim_subtitles',               group: 'dimension_value' },
  { key: 'playback_location',    label: 'Playback location',          table: 'yt_dim_playback_location',       videoTable: 'yt_video_dim_playback_location',       group: 'dimension_value' },
  { key: 'device',               label: 'Device type',                table: 'yt_dim_device',                  videoTable: 'yt_video_dim_device',                  group: 'dimension_value' },
  { key: 'os',                   label: 'Operating system',           table: 'yt_dim_os',                      videoTable: 'yt_video_dim_os',                      group: 'dimension_value' },
  { key: 'subscription_source',  label: 'Subscription source',        table: 'yt_dim_subscription_source',     videoTable: 'yt_video_dim_subscription_source',     group: 'dimension_value' },
  { key: 'sharing_service',      label: 'Sharing service',            table: 'yt_dim_sharing_service',         videoTable: 'yt_video_dim_sharing_service',         group: 'dimension_value' },
  { key: 'subscription_status',  label: 'Subscription status',        table: 'yt_dim_subscription_status',     videoTable: 'yt_video_dim_subscription_status',     group: 'dimension_value' },
  { key: 'viewer_type',          label: 'New and returning viewers',  table: 'yt_dim_viewer_type',             videoTable: 'yt_video_dim_viewer_type',             group: 'dimension_value' },
  { key: 'age',                  label: 'Viewer age',                 table: 'yt_dim_age',                     videoTable: 'yt_video_dim_age',                     group: 'dimension_value' },
  { key: 'gender',               label: 'Viewer gender',              table: 'yt_dim_gender',                  videoTable: 'yt_video_dim_gender',                  group: 'dimension_value' },
  { key: 'playlist',             label: 'Playlists',                  table: 'yt_dim_playlist',                videoTable: 'yt_video_dim_playlist',                group: 'dimension_value' },
  { key: 'date',                 label: 'Date',                       table: 'yt_dim_traffic_source',          group: 'date',           isTime: true, bucket: 'day' },
  { key: 'month',                label: 'Month',                      table: 'yt_dim_traffic_source',          group: 'date',           isTime: true, bucket: 'month' },
];

// Metric catalog. `agg` controls how multiple rows combine:
//   sum               — straight addition
//   weighted:<col>    — weighted average where the weights are sums of <col>
// `format` controls display.
const METRICS = [
  { key: 'views',                          label: 'Views',                    agg: 'sum',                    format: 'compact',  group: 'Reach' },
  { key: 'watch_time_minutes',             label: 'Watch time (hours)',       agg: 'sum',                    format: 'hours',    group: 'Reach' },
  { key: 'impressions',                    label: 'Impressions',              agg: 'sum',                    format: 'compact',  group: 'Reach' },
  { key: 'impressions_ctr',                label: 'Impressions CTR (%)',      agg: 'weighted:impressions',   format: 'percent',  group: 'Reach' },
  { key: 'unique_viewers',                 label: 'Unique viewers',           agg: 'sum',                    format: 'compact',  group: 'Reach' },
  { key: 'average_view_duration_seconds',  label: 'Average view duration',    agg: 'weighted:views',         format: 'duration', group: 'Engagement' },
  { key: 'average_view_percentage',        label: 'Average percentage viewed (%)', agg: 'weighted:views',    format: 'percent',  group: 'Engagement' },
  { key: 'subscribers_gained',             label: 'Subscribers gained',       agg: 'sum',                    format: 'compact',  group: 'Engagement' },
  { key: 'subscribers_lost',               label: 'Subscribers lost',         agg: 'sum',                    format: 'compact',  group: 'Engagement' },
  { key: 'likes',                          label: 'Likes',                    agg: 'sum',                    format: 'compact',  group: 'Engagement' },
  { key: 'dislikes',                       label: 'Dislikes',                 agg: 'sum',                    format: 'compact',  group: 'Engagement' },
  { key: 'comments',                       label: 'Comments added',           agg: 'sum',                    format: 'compact',  group: 'Engagement' },
  { key: 'shares',                         label: 'Shares',                   agg: 'sum',                    format: 'compact',  group: 'Engagement' },
  { key: 'videos_added_to_playlists',      label: 'Videos added to playlists',agg: 'sum',                    format: 'compact',  group: 'Engagement' },
  { key: 'videos_removed_from_playlists',  label: 'Videos removed from playlists', agg: 'sum',               format: 'compact',  group: 'Engagement' },
  { key: 'estimated_revenue',              label: 'Estimated revenue (USD)',  agg: 'sum',                    format: 'currency', group: 'Revenue' },
  { key: 'ad_revenue',                     label: 'Estimated ad revenue',     agg: 'sum',                    format: 'currency', group: 'Revenue' },
  { key: 'gross_revenue',                  label: 'Gross revenue',            agg: 'sum',                    format: 'currency', group: 'Revenue' },
  { key: 'premium_revenue',                label: 'YouTube Premium revenue',  agg: 'sum',                    format: 'currency', group: 'Revenue' },
  { key: 'monetized_playbacks',            label: 'Monetized playbacks',      agg: 'sum',                    format: 'compact',  group: 'Revenue' },
  { key: 'playback_based_cpm',             label: 'Playback-based CPM (USD)', agg: 'weighted:monetized_playbacks', format: 'currency', group: 'Revenue' },
  { key: 'cpm',                            label: 'CPM (USD)',                agg: 'weighted:ad_impressions', format: 'currency',group: 'Revenue' },
  { key: 'ad_impressions',                 label: 'Ad impressions',           agg: 'sum',                    format: 'compact',  group: 'Revenue' },
  { key: 'red_views',                      label: 'Premium views',            agg: 'sum',                    format: 'compact',  group: 'Revenue' },
  { key: 'red_watch_time_minutes',         label: 'Premium watch time',       agg: 'sum',                    format: 'hours',    group: 'Revenue' },
];

const METRIC_BY_KEY = Object.fromEntries(METRICS.map(m => [m.key, m]));

// Studio-style date presets
const DATE_PRESETS = [
  { key: '7d',         label: 'Last 7 days',          days: 7 },
  { key: '28d',        label: 'Last 28 days',         days: 28 },
  { key: '90d',        label: 'Last 90 days',         days: 90 },
  { key: '365d',       label: 'Last 365 days',        days: 365 },
  { key: 'lifetime',   label: 'Lifetime' },
  { key: 'this_year',  label: 'This year (Jan 1 – today)' },
  { key: 'last_year',  label: 'Last calendar year' },
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'custom',     label: 'Custom' },
];

const COMPARE_PRESETS = [
  { key: 'none',     label: 'No comparison' },
  { key: 'previous', label: 'Previous period' },
  { key: 'yoy',      label: 'Same period last year' },
  { key: 'custom',   label: 'Custom' },
];

const CHART_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ec4899', '#3b82f6', '#a855f7', '#14b8a6', '#f97316'];

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════
const PT_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
});
const todayStr = () => PT_FMT.format(new Date());
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return PT_FMT.format(d);
};

function resolveDateRange(preset, customStart, customEnd) {
  const today = todayStr();
  switch (preset) {
    case '7d':   return { start: daysAgo(7),   end: today };
    case '28d':  return { start: daysAgo(28),  end: today };
    case '90d':  return { start: daysAgo(90),  end: today };
    case '365d': return { start: daysAgo(365), end: today };
    case 'lifetime':   return { start: '2005-01-01', end: today };
    case 'this_year':  return { start: `${new Date().getFullYear()}-01-01`, end: today };
    case 'last_year': {
      const y = new Date().getFullYear() - 1;
      return { start: `${y}-01-01`, end: `${y}-12-31` };
    }
    case 'this_month': {
      const d = new Date();
      const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0');
      return { start: `${y}-${m}-01`, end: today };
    }
    case 'last_month': {
      const d = new Date();
      d.setMonth(d.getMonth() - 1);
      const y = d.getFullYear(), m = d.getMonth();
      const first = `${y}-${String(m + 1).padStart(2, '0')}-01`;
      const last = new Date(y, m + 1, 0);
      const lastStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
      return { start: first, end: lastStr };
    }
    case 'custom':
      if (customStart && customEnd) return { start: customStart, end: customEnd };
      return { start: daysAgo(28), end: today };
    default:
      return { start: daysAgo(28), end: today };
  }
}

function resolveComparePeriod(mode, current, customStart, customEnd) {
  if (mode === 'none' || !current) return null;
  const start = new Date(current.start);
  const end = new Date(current.end);
  const days = Math.round((end - start) / 86400000) + 1;
  if (mode === 'previous') {
    const prevEnd = new Date(start.getTime() - 86400000);
    const prevStart = new Date(prevEnd.getTime() - (days - 1) * 86400000);
    return { start: prevStart.toISOString().split('T')[0], end: prevEnd.toISOString().split('T')[0] };
  }
  if (mode === 'yoy') {
    const yoyStart = new Date(start); yoyStart.setFullYear(yoyStart.getFullYear() - 1);
    const yoyEnd = new Date(end); yoyEnd.setFullYear(yoyEnd.getFullYear() - 1);
    return { start: yoyStart.toISOString().split('T')[0], end: yoyEnd.toISOString().split('T')[0] };
  }
  if (mode === 'custom' && customStart && customEnd) {
    return { start: customStart, end: customEnd };
  }
  return null;
}

function formatValue(value, format) {
  if (value == null || isNaN(value)) return '—';
  const n = Number(value);
  switch (format) {
    case 'currency':
      return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case 'percent':
      return n.toFixed(2) + '%';
    case 'duration': {
      const s = Math.round(n);
      const mm = Math.floor(s / 60);
      const ss = String(s % 60).padStart(2, '0');
      return `${mm}:${ss}`;
    }
    case 'hours':
      // watch_time_minutes → hours
      return (n / 60).toLocaleString(undefined, { maximumFractionDigits: 1 });
    case 'compact':
    default:
      if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
      if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + 'K';
      return n.toLocaleString();
  }
}

// Combine rows across channels using metric agg rules.
function aggregateRows(rows) {
  if (rows.length === 0) return {};
  if (rows.length === 1) return rows[0];
  const out = {};
  for (const m of METRICS) {
    if (m.agg === 'sum') {
      out[m.key] = rows.reduce((s, r) => s + (Number(r[m.key]) || 0), 0);
    } else if (m.agg.startsWith('weighted:')) {
      const weightKey = m.agg.split(':')[1];
      let numer = 0, denom = 0;
      for (const r of rows) {
        const v = Number(r[m.key]) || 0;
        const w = Number(r[weightKey]) || 0;
        numer += v * w;
        denom += w;
      }
      out[m.key] = denom > 0 ? numer / denom : 0;
    }
  }
  return out;
}

// Group rows by a key, then aggregate within each group.
function groupAndAggregate(rows, keyFn, labelFn = (k) => k) {
  const groups = {};
  for (const r of rows) {
    const k = keyFn(r);
    if (!groups[k]) groups[k] = [];
    groups[k].push(r);
  }
  return Object.entries(groups).map(([k, gRows]) => ({
    _key: k,
    _label: labelFn(k, gRows),
    ...aggregateRows(gRows),
  }));
}

function monthKey(dateStr) {
  return (dateStr || '').slice(0, 7);
}

function formatMonth(yyyyMm) {
  const [y, m] = yyyyMm.split('-');
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${MONTHS[parseInt(m, 10) - 1]} ${y}`;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// CSV export
function downloadCsv(filename, rows, columns) {
  const escape = (v) => {
    if (v == null) return '';
    const s = String(v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const header = columns.map(c => escape(c.label)).join(',');
  const body = rows.map(r => columns.map(c => escape(r[c.key])).join(',')).join('\n');
  const blob = new Blob([header + '\n' + body], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════
export default function YouTubeStudioAdvanced({ accounts }) {
  const { user } = useAuth();

  // YouTube channels only
  const ytChannels = useMemo(
    () => (accounts || []).filter(a => a.platform === 'youtube'),
    [accounts]
  );

  // ── Selection state ──
  const [selectedChannelIds, setSelectedChannelIds] = useState([]); // empty = all
  const effectiveChannelIds = useMemo(
    () => selectedChannelIds.length ? selectedChannelIds : ytChannels.map(c => c.id),
    [selectedChannelIds, ytChannels]
  );

  const [datePreset, setDatePreset] = useState('28d');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const dateRange = useMemo(
    () => resolveDateRange(datePreset, customStart, customEnd),
    [datePreset, customStart, customEnd]
  );

  const [compareMode, setCompareMode] = useState('none');
  const [compareCustomStart, setCompareCustomStart] = useState('');
  const [compareCustomEnd, setCompareCustomEnd] = useState('');
  const comparePeriod = useMemo(
    () => resolveComparePeriod(compareMode, dateRange, compareCustomStart, compareCustomEnd),
    [compareMode, dateRange, compareCustomStart, compareCustomEnd]
  );

  const [dimension, setDimension] = useState('content');
  const dimensionDef = DIMENSIONS.find(d => d.key === dimension);

  const [activeMetrics, setActiveMetrics] = useState(['views', 'watch_time_minutes', 'subscribers_gained', 'estimated_revenue']);
  const [chartMetric, setChartMetric] = useState('views');
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);

  const [sortCol, setSortCol] = useState('views');
  const [sortDir, setSortDir] = useState('desc');

  const [drilldownVideoId, setDrilldownVideoId] = useState(null);
  const [showMetricPicker, setShowMetricPicker] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showComparePicker, setShowComparePicker] = useState(false);
  const [showChannelPicker, setShowChannelPicker] = useState(false);
  const [showDimPicker, setShowDimPicker] = useState(false);

  // Click-outside handling
  const metricPickerRef = useRef(null);
  const datePickerRef = useRef(null);
  const comparePickerRef = useRef(null);
  const channelPickerRef = useRef(null);
  const dimPickerRef = useRef(null);
  useEffect(() => {
    const onClick = (e) => {
      if (metricPickerRef.current && !metricPickerRef.current.contains(e.target)) setShowMetricPicker(false);
      if (datePickerRef.current && !datePickerRef.current.contains(e.target)) setShowDatePicker(false);
      if (comparePickerRef.current && !comparePickerRef.current.contains(e.target)) setShowComparePicker(false);
      if (channelPickerRef.current && !channelPickerRef.current.contains(e.target)) setShowChannelPicker(false);
      if (dimPickerRef.current && !dimPickerRef.current.contains(e.target)) setShowDimPicker(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // ── Data fetch ──
  const [tableRows, setTableRows] = useState([]);
  const [compareRows, setCompareRows] = useState([]);
  const [chartSeries, setChartSeries] = useState([]); // [{ key, label, color, points: [{ date, value }] }]
  const [loading, setLoading] = useState(false);

  // Video metadata cache (id → { title, thumbnail_url, url })
  const [videoMeta, setVideoMeta] = useState({});

  // Freshness: newest date we actually have data for (YouTube Analytics finalizes
  // several days late, so the current window can legitimately be empty).
  const [latestDataDate, setLatestDataDate] = useState(null);
  const didAutoAdjustRef = useRef(false);

  const fetchGen = useRef(0);

  useEffect(() => {
    fetchAll();
  }, [
    effectiveChannelIds.join(','),
    dateRange.start, dateRange.end,
    comparePeriod?.start, comparePeriod?.end,
    dimension,
    chartMetric,
    selectedRowKeys.join('|'),
  ]);

  // Track the newest date with data for the selected channels.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (effectiveChannelIds.length === 0) { setLatestDataDate(null); return; }
      const { data } = await supabase
        .from('yt_video_daily')
        .select('date')
        .in('platform_account_id', effectiveChannelIds)
        .order('date', { ascending: false })
        .limit(1);
      if (!cancelled) setLatestDataDate(data?.[0]?.date || null);
    })();
    return () => { cancelled = true; };
  }, [effectiveChannelIds.join(',')]);

  // Smarter default: if the data is clearly stale, shift the initial 28-day
  // window to end at the latest available date so the view isn't blank. Only
  // overrides the untouched default, and only once.
  useEffect(() => {
    if (didAutoAdjustRef.current || !latestDataDate) return;
    const behind = Math.round((new Date(todayStr()) - new Date(latestDataDate)) / 86400000);
    if (datePreset === '28d' && behind > 3) {
      const start = new Date(new Date(latestDataDate).getTime() - 27 * 86400000).toISOString().split('T')[0];
      setCustomStart(start);
      setCustomEnd(latestDataDate);
      setDatePreset('custom');
    }
    didAutoAdjustRef.current = true;
  }, [latestDataDate, datePreset]);

  async function fetchAll() {
    const gen = ++fetchGen.current;
    const isCurrent = () => gen === fetchGen.current;
    setLoading(true);
    try {
      // 1) Table rows (current period, grouped by dimension)
      const tRows = await fetchTableRows(dateRange, isCurrent);
      if (!isCurrent()) return;
      setTableRows(tRows);

      // 2) Compare period rows (same shape) if comparison is on
      if (comparePeriod) {
        const cRows = await fetchTableRows(comparePeriod, isCurrent);
        if (!isCurrent()) return;
        setCompareRows(cRows);
      } else {
        setCompareRows([]);
      }

      // 3) Chart series (chartMetric over time, with optional row breakdowns)
      const series = await fetchChartSeries(dateRange, isCurrent);
      if (!isCurrent()) return;
      setChartSeries(series);

      // 4) Video metadata if grouping by content (or rows reference video ids)
      if (dimensionDef?.isContent && tRows.length > 0) {
        const ids = tRows.map(r => r._key).filter(Boolean).slice(0, 200);
        if (ids.length > 0) {
          const { data: vids } = await supabase.from('content_items')
            .select('external_id, title, thumbnail_url, url, platform_account_id')
            .in('external_id', ids);
          if (isCurrent()) {
            const map = { ...videoMeta };
            for (const v of (vids || [])) map[v.external_id] = v;
            setVideoMeta(map);
          }
        }
      }
    } catch (e) {
      console.error('YT Studio fetch error:', e);
    }
    if (isCurrent()) setLoading(false);
  }

  // Fetch and group rows for the table
  // PostgREST caps each response (default 1000 rows), and these tables hold one
  // row per (video|dimension × day), so a single .limit() silently returns an
  // arbitrary partial slice — which made charts show the wrong date span. Page
  // through the entire result set instead. Cap-agnostic: the effective page size
  // is learned from the first page, so it works whatever the server limit is.
  async function fetchAllRows(table, range, orderCols) {
    const all = [];
    let from = 0;
    let pageSize = null;
    // hard safety ceiling so pathological ranges can't loop forever
    while (from <= 100000) {
      let q = supabase.from(table).select('*')
        .gte('date', range.start).lte('date', range.end)
        .in('platform_account_id', effectiveChannelIds);
      for (const col of orderCols) q = q.order(col, { ascending: true });
      const { data, error } = await q.range(from, from + 999);
      if (error || !data || data.length === 0) break;
      all.push(...data);
      if (pageSize === null) pageSize = data.length; // == server cap (<= 1000)
      from += data.length;
      if (data.length < pageSize) break; // short page → last page
    }
    return all;
  }

  async function fetchTableRows(range, isCurrent) {
    if (effectiveChannelIds.length === 0) return [];

    if (dimensionDef.isContent) {
      // yt_video_daily — group by video_id
      const rows = await fetchAllRows('yt_video_daily', range, ['date', 'video_id', 'platform_account_id']);
      if (!isCurrent()) return [];
      return groupAndAggregate(rows, r => r.video_id, k => k);
    }

    if (dimensionDef.isTime) {
      // Sum across one dim table (use traffic_source as the canonical channel-rollup
      // since channel totals = sum across any complete dimension; traffic_source covers all views).
      const rows = await fetchAllRows(dimensionDef.table, range, ['date', 'dimension_value', 'platform_account_id']);
      if (!isCurrent()) return [];
      const bucketFn = dimensionDef.bucket === 'month' ? (r) => monthKey(r.date) : (r) => r.date;
      const labelFn = dimensionDef.bucket === 'month' ? formatMonth : formatDate;
      // Group by date AND sum all dimension_values into that date
      return groupAndAggregate(rows, bucketFn, labelFn);
    }

    // Standard dimension table
    const rows = await fetchAllRows(dimensionDef.table, range, ['date', 'dimension_value', 'platform_account_id']);
    if (!isCurrent()) return [];
    return groupAndAggregate(rows, r => r.dimension_value, k => k);
  }

  // Chart series: one line for the totals + one extra line per selected row.
  async function fetchChartSeries(range, isCurrent) {
    if (effectiveChannelIds.length === 0) return [];

    const metricDef = METRIC_BY_KEY[chartMetric];
    if (!metricDef) return [];

    const table = dimensionDef.isContent ? 'yt_video_daily' : dimensionDef.table;
    const groupCol = dimensionDef.isContent ? 'video_id' : 'dimension_value';
    const orderCols = ['date', groupCol, 'platform_account_id'];

    const rows = await fetchAllRows(table, range, orderCols);
    if (!isCurrent()) return [];

    // Always include the totals line
    const totalsByDate = groupAndAggregate(rows, r => r.date, k => k);
    totalsByDate.sort((a, b) => a._key.localeCompare(b._key));
    const totalsSeries = {
      key: '__totals__',
      label: 'Total',
      color: CHART_COLORS[0],
      points: totalsByDate.map(r => ({ date: r._key, value: r[chartMetric] || 0 })),
    };

    const seriesArr = [totalsSeries];

    // Comparison overlay: fetch the compare period and re-map each point onto the
    // current range's x-axis by day-offset (day 1 → day 1), so both lines align.
    if (comparePeriod) {
      const cmpRows = await fetchAllRows(table, comparePeriod, orderCols);
      if (!isCurrent()) return [];
      const cmpByDate = groupAndAggregate(cmpRows, r => r.date, k => k);
      cmpByDate.sort((a, b) => a._key.localeCompare(b._key));
      const startCur = new Date(range.start + 'T00:00:00');
      const startCmp = new Date(comparePeriod.start + 'T00:00:00');
      const cmpLabel = compareMode === 'yoy' ? 'Same period last year'
        : compareMode === 'previous' ? 'Previous period' : 'Comparison';
      seriesArr.push({
        key: '__compare__',
        label: cmpLabel,
        color: '#94a3b8',
        dashed: true,
        points: cmpByDate.map(r => {
          const off = Math.round((new Date(r._key + 'T00:00:00') - startCmp) / 86400000);
          const mapped = new Date(startCur.getTime() + off * 86400000).toISOString().split('T')[0];
          return { date: mapped, value: r[chartMetric] || 0, realDate: r._key };
        }),
      });
    }

    // Per-selected-row series
    for (let i = 0; i < selectedRowKeys.length && i < 7; i++) {
      const key = selectedRowKeys[i];
      const filtered = rows.filter(r => r[groupCol] === key);
      const byDate = groupAndAggregate(filtered, r => r.date, k => k);
      byDate.sort((a, b) => a._key.localeCompare(b._key));
      seriesArr.push({
        key,
        label: dimensionDef.isContent ? (videoMeta[key]?.title || key) : key,
        color: CHART_COLORS[(i + 1) % CHART_COLORS.length],
        points: byDate.map(r => ({ date: r._key, value: r[chartMetric] || 0 })),
      });
    }
    return seriesArr;
  }

  // ── Sorting ──
  const sortedTableRows = useMemo(() => {
    if (!sortCol) return tableRows;
    return [...tableRows].sort((a, b) => {
      if (sortCol === '_label') {
        const av = String(a._label || ''), bv = String(b._label || '');
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const av = Number(a[sortCol]) || 0, bv = Number(b[sortCol]) || 0;
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  }, [tableRows, sortCol, sortDir]);

  function handleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('desc'); }
  }

  // ── Channel toggles ──
  function toggleChannel(id) {
    setSelectedChannelIds(prev => prev.includes(id) ? prev.filter(v => v !== id) : [...prev, id]);
    setSelectedRowKeys([]); // reset chart selections when channel scope changes
  }
  function clearChannels() { setSelectedChannelIds([]); setSelectedRowKeys([]); }

  // ── Row toggles (for chart overlay) ──
  function toggleRowSelect(key) {
    setSelectedRowKeys(prev => {
      if (prev.includes(key)) return prev.filter(v => v !== key);
      if (prev.length >= 7) return prev; // chart cap
      return [...prev, key];
    });
  }

  // ── Metric toggles ──
  function toggleMetric(key) {
    setActiveMetrics(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  }

  // ── Comparison delta lookup ──
  const compareByKey = useMemo(() => {
    const m = {};
    for (const r of compareRows) m[r._key] = r;
    return m;
  }, [compareRows]);

  // Range-wide totals (each metric aggregated across all dimension values).
  // Chart-tab labels read from this so e.g. the Revenue tab shows revenue,
  // not whatever the active chartMetric happens to be.
  const totalsAgg = useMemo(() => aggregateRows(tableRows), [tableRows]);

  // ── CSV export ──
  function exportCsv() {
    const cols = [
      { key: '_label', label: dimensionDef.label },
      ...activeMetrics.map(k => ({ key: k, label: METRIC_BY_KEY[k]?.label || k })),
    ];
    const rows = sortedTableRows.map(r => {
      const out = { _label: dimensionDef.isContent ? (videoMeta[r._key]?.title || r._key) : (r._label || r._key) };
      for (const m of activeMetrics) {
        const def = METRIC_BY_KEY[m];
        out[m] = def?.format === 'hours' ? ((r[m] || 0) / 60).toFixed(2) : (r[m] || 0);
      }
      return out;
    });
    const stamp = new Date().toISOString().split('T')[0];
    downloadCsv(`youtube-studio-${dimension}-${stamp}.csv`, rows, cols);
  }

  // ── Saved views ──
  const [savedViews, setSavedViews] = useState([]);
  const [showSavedViews, setShowSavedViews] = useState(false);
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase.from('yt_studio_saved_views')
        .select('*').eq('user_id', user.id).order('created_at', { ascending: false });
      setSavedViews(data || []);
    })();
  }, [user]);

  async function saveCurrentView() {
    if (!user) return;
    const name = window.prompt('Name this view:');
    if (!name) return;
    const config = {
      dimension, activeMetrics, chartMetric, datePreset, customStart, customEnd,
      compareMode, compareCustomStart, compareCustomEnd, selectedChannelIds,
    };
    const { data, error } = await supabase.from('yt_studio_saved_views')
      .upsert({ user_id: user.id, name, config, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,name' }).select().single();
    if (error) { console.error(error); return; }
    setSavedViews(prev => {
      const without = prev.filter(v => v.name !== name);
      return [data, ...without];
    });
  }

  function loadSavedView(view) {
    const c = view.config || {};
    if (c.dimension) setDimension(c.dimension);
    if (c.activeMetrics) setActiveMetrics(c.activeMetrics);
    if (c.chartMetric) setChartMetric(c.chartMetric);
    if (c.datePreset) setDatePreset(c.datePreset);
    if (c.customStart) setCustomStart(c.customStart);
    if (c.customEnd) setCustomEnd(c.customEnd);
    if (c.compareMode) setCompareMode(c.compareMode);
    if (c.compareCustomStart) setCompareCustomStart(c.compareCustomStart);
    if (c.compareCustomEnd) setCompareCustomEnd(c.compareCustomEnd);
    if (c.selectedChannelIds) setSelectedChannelIds(c.selectedChannelIds);
    setSelectedRowKeys([]);
    setShowSavedViews(false);
  }

  async function deleteSavedView(id) {
    await supabase.from('yt_studio_saved_views').delete().eq('id', id);
    setSavedViews(prev => prev.filter(v => v.id !== id));
  }

  // ═══════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════
  if (ytChannels.length === 0) {
    return (
      <div style={S.emptyCard}>
        <p style={S.emptyText}>No YouTube channels found. Connect a channel in Settings to use the YouTube Studio view.</p>
      </div>
    );
  }

  const daysBehind = latestDataDate
    ? Math.round((new Date(todayStr()) - new Date(latestDataDate)) / 86400000)
    : 0;
  const isStale = latestDataDate && daysBehind > 3;

  function jumpToLatest() {
    if (!latestDataDate) return;
    const start = new Date(new Date(latestDataDate).getTime() - 27 * 86400000).toISOString().split('T')[0];
    setCustomStart(start);
    setCustomEnd(latestDataDate);
    setDatePreset('custom');
  }

  return (
    <div>
      {isStale && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          padding: '10px 14px', marginBottom: 12, borderRadius: 10,
          background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.35)',
          color: '#fbbf24', fontSize: 13,
        }}>
          <span style={{ fontSize: 15 }}>⚠️</span>
          <span style={{ flex: 1, minWidth: 220 }}>
            YouTube Studio data is <strong>{daysBehind} days behind</strong> — latest available: <strong>{formatDate(latestDataDate)}</strong>. YouTube finalizes analytics a few days late; if it stays this far back the daily sync needs attention.
          </span>
          <button onClick={jumpToLatest} style={{ ...S.headerChip, whiteSpace: 'nowrap' }}>
            View latest 28 days
          </button>
        </div>
      )}
      {/* ── Top header strip ── */}
      <div style={S.studioHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={S.studioTitle}>YouTube Studio — Advanced</span>
          <span style={S.dateRangeLabel}>{formatDate(dateRange.start)} – {formatDate(dateRange.end)}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {/* Channel multi-select */}
          <div ref={channelPickerRef} style={{ position: 'relative' }}>
            <button onClick={() => setShowChannelPicker(o => !o)} style={S.headerChip}>
              {selectedChannelIds.length === 0 ? `All channels (${ytChannels.length})`
                : selectedChannelIds.length === 1
                  ? ytChannels.find(c => c.id === selectedChannelIds[0])?.account_name
                  : `${selectedChannelIds.length} channels`}
              <span style={S.chev}>▾</span>
            </button>
            {showChannelPicker && (
              <div style={S.dropdown}>
                {selectedChannelIds.length > 0 && (
                  <button onClick={clearChannels} style={S.dropdownClear}>All channels</button>
                )}
                {ytChannels.map(c => (
                  <button key={c.id} onClick={() => toggleChannel(c.id)} style={{
                    ...S.dropdownItem,
                    ...(selectedChannelIds.includes(c.id) ? S.dropdownItemActive : {}),
                  }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#FF0000' }} />
                    <span style={{ flex: 1 }}>{c.account_name}</span>
                    {selectedChannelIds.includes(c.id) && <span style={{ color: '#a5b4fc' }}>✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Date range picker */}
          <div ref={datePickerRef} style={{ position: 'relative' }}>
            <button onClick={() => setShowDatePicker(o => !o)} style={S.headerChip}>
              {DATE_PRESETS.find(p => p.key === datePreset)?.label || 'Date range'}
              <span style={S.chev}>▾</span>
            </button>
            {showDatePicker && (
              <div style={S.dropdown}>
                {DATE_PRESETS.map(p => (
                  <button key={p.key} onClick={() => { setDatePreset(p.key); if (p.key !== 'custom') setShowDatePicker(false); }}
                    style={{ ...S.dropdownItem, ...(datePreset === p.key ? S.dropdownItemActive : {}) }}>
                    {p.label}
                  </button>
                ))}
                {datePreset === 'custom' && (
                  <div style={{ padding: 8, display: 'flex', gap: 6, flexDirection: 'column' }}>
                    <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} style={S.input} />
                    <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} style={S.input} />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Compare picker */}
          <div ref={comparePickerRef} style={{ position: 'relative' }}>
            <button onClick={() => setShowComparePicker(o => !o)}
              style={{ ...S.headerChip, ...(compareMode !== 'none' ? S.headerChipActive : {}) }}>
              {compareMode === 'none' ? 'Compare to' : `vs ${COMPARE_PRESETS.find(p => p.key === compareMode)?.label}`}
              <span style={S.chev}>▾</span>
            </button>
            {showComparePicker && (
              <div style={S.dropdown}>
                {COMPARE_PRESETS.map(p => (
                  <button key={p.key} onClick={() => { setCompareMode(p.key); if (p.key !== 'custom') setShowComparePicker(false); }}
                    style={{ ...S.dropdownItem, ...(compareMode === p.key ? S.dropdownItemActive : {}) }}>
                    {p.label}
                  </button>
                ))}
                {compareMode === 'custom' && (
                  <div style={{ padding: 8, display: 'flex', gap: 6, flexDirection: 'column' }}>
                    <input type="date" value={compareCustomStart} onChange={e => setCompareCustomStart(e.target.value)} style={S.input} />
                    <input type="date" value={compareCustomEnd} onChange={e => setCompareCustomEnd(e.target.value)} style={S.input} />
                  </div>
                )}
              </div>
            )}
          </div>

          <button onClick={exportCsv} style={S.headerChip} title="Export CSV">⬇ Export</button>
          <button onClick={saveCurrentView} style={S.headerChip} title="Save view">⭑ Save view</button>
          <button onClick={() => setShowSavedViews(o => !o)} style={S.headerChip} title="Saved views">☰ {savedViews.length || ''}</button>
        </div>
      </div>

      {/* ── Saved views panel ── */}
      {showSavedViews && (
        <div style={S.savedPanel}>
          {savedViews.length === 0 && <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>No saved views yet.</span>}
          {savedViews.map(v => (
            <div key={v.id} style={S.savedRow}>
              <button onClick={() => loadSavedView(v)} style={S.savedLoadBtn}>{v.name}</button>
              <button onClick={() => deleteSavedView(v.id)} style={S.savedDelBtn} title="Delete">✕</button>
            </div>
          ))}
        </div>
      )}

      {/* ── Chart card ── */}
      <div style={S.card}>
        <div style={S.chartTabs}>
          {METRICS.filter(m => ['views','watch_time_minutes','subscribers_gained','estimated_revenue','impressions','impressions_ctr','average_view_duration_seconds'].includes(m.key)).map(m => (
            <button key={m.key} onClick={() => setChartMetric(m.key)}
              style={{ ...S.chartTab, ...(chartMetric === m.key ? S.chartTabActive : {}) }}>
              <div style={S.chartTabLabel}>{m.label}</div>
              <div style={S.chartTabValue}>
                {formatValue(totalsAgg[m.key], m.format)}
              </div>
            </button>
          ))}
        </div>

        <StudioLineChart series={chartSeries} metricDef={METRIC_BY_KEY[chartMetric]} />
        {loading && <div style={S.loadingOverlay}>Loading…</div>}
      </div>

      {/* ── Pivot table card ── */}
      <div style={S.card}>
        <div style={S.tableTopBar}>
          <div ref={dimPickerRef} style={{ position: 'relative' }}>
            <button onClick={() => setShowDimPicker(o => !o)} style={S.dimensionBtn}>
              <span style={{ color: 'rgba(255,255,255,0.4)', fontWeight: 500, marginRight: 6 }}>Rows:</span>
              {dimensionDef.label} <span style={S.chev}>▾</span>
            </button>
            {showDimPicker && (
              <div style={{ ...S.dropdown, maxHeight: 400, overflowY: 'auto', minWidth: 240 }}>
                {DIMENSIONS.map(d => (
                  <button key={d.key} onClick={() => { setDimension(d.key); setSelectedRowKeys([]); setShowDimPicker(false); setSortCol('views'); setSortDir('desc'); }}
                    style={{ ...S.dropdownItem, ...(dimension === d.key ? S.dropdownItemActive : {}) }}>
                    {d.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div ref={metricPickerRef} style={{ position: 'relative' }}>
            <button onClick={() => setShowMetricPicker(o => !o)} style={S.dimensionBtn}>
              + Add metric <span style={S.chev}>▾</span>
            </button>
            {showMetricPicker && <MetricOverlay activeMetrics={activeMetrics} toggleMetric={toggleMetric} />}
          </div>
        </div>

        <div style={S.tableScroll}>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={{ ...S.th, ...S.thSticky, width: 36 }}></th>
                <th onClick={() => handleSort('_label')} style={{ ...S.th, ...S.thSticky, left: 36, cursor: 'pointer' }}>
                  {dimensionDef.label}
                  {sortCol === '_label' && <span style={S.sortArrow}>{sortDir === 'asc' ? '↑' : '↓'}</span>}
                </th>
                {activeMetrics.map(m => {
                  const def = METRIC_BY_KEY[m];
                  return (
                    <th key={m} onClick={() => handleSort(m)} style={{ ...S.th, cursor: 'pointer', textAlign: 'right' }}>
                      {def?.label || m}
                      {sortCol === m && <span style={S.sortArrow}>{sortDir === 'asc' ? '↑' : '↓'}</span>}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {/* Totals row */}
              <tr style={S.totalsRow}>
                <td style={{ ...S.td, ...S.tdSticky, width: 36 }}></td>
                <td style={{ ...S.td, ...S.tdSticky, left: 36, fontWeight: 700 }}>Total</td>
                {activeMetrics.map(m => {
                  const def = METRIC_BY_KEY[m];
                  const agg = aggregateRows(tableRows);
                  return (
                    <td key={m} style={{ ...S.td, textAlign: 'right', fontWeight: 700, color: '#fff' }}>
                      {formatValue(agg[m], def?.format)}
                    </td>
                  );
                })}
              </tr>
              {sortedTableRows.map((r, ri) => {
                const isSelected = selectedRowKeys.includes(r._key);
                const meta = dimensionDef.isContent ? videoMeta[r._key] : null;
                return (
                  <tr key={r._key} style={ri % 2 ? S.trEven : null}>
                    <td style={{ ...S.td, ...S.tdSticky, width: 36 }}>
                      <input type="checkbox" checked={isSelected} onChange={() => toggleRowSelect(r._key)} style={{ accentColor: '#6366f1' }} />
                    </td>
                    <td style={{ ...S.td, ...S.tdSticky, left: 36, maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {dimensionDef.isContent ? (
                        <button onClick={() => setDrilldownVideoId(r._key)} style={S.videoLink} title="Open drilldown">
                          {meta?.thumbnail_url && <img src={meta.thumbnail_url} alt="" style={S.thumb} />}
                          <span>{meta?.title || r._key}</span>
                        </button>
                      ) : r._label || r._key}
                    </td>
                    {activeMetrics.map(m => {
                      const def = METRIC_BY_KEY[m];
                      const v = r[m];
                      const prev = compareByKey[r._key]?.[m];
                      const delta = prev != null && prev !== 0 ? ((v - prev) / Math.abs(prev)) * 100 : null;
                      return (
                        <td key={m} style={{ ...S.td, textAlign: 'right' }}>
                          <div style={S.tdValue}>{formatValue(v, def?.format)}</div>
                          {delta != null && (
                            <div style={{ ...S.tdDelta, color: delta >= 0 ? '#4ade80' : '#f87171' }}>
                              {delta >= 0 ? '+' : ''}{delta.toFixed(1)}%
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {sortedTableRows.length === 0 && !loading && (
                <tr><td colSpan={2 + activeMetrics.length} style={{ ...S.td, textAlign: 'center', padding: 40, color: 'rgba(255,255,255,0.3)' }}>
                  No data for this date range. Run the backfill if you haven't already.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Drilldown panel ── */}
      {drilldownVideoId && (
        <VideoDrilldown
          videoId={drilldownVideoId}
          channels={effectiveChannelIds}
          dateRange={dateRange}
          videoMeta={videoMeta[drilldownVideoId]}
          onClose={() => setDrilldownVideoId(null)}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Metric picker overlay (Studio's "See more" / metric multi-select)
// ═══════════════════════════════════════════════════════════════════
function MetricOverlay({ activeMetrics, toggleMetric }) {
  const grouped = useMemo(() => {
    const g = {};
    for (const m of METRICS) {
      if (!g[m.group]) g[m.group] = [];
      g[m.group].push(m);
    }
    return g;
  }, []);
  return (
    <div style={{ ...S.dropdown, minWidth: 320, maxHeight: 480, overflowY: 'auto' }}>
      {Object.entries(grouped).map(([group, metrics]) => (
        <div key={group}>
          <div style={S.metricGroupHeader}>{group}</div>
          {metrics.map(m => (
            <button key={m.key} onClick={() => toggleMetric(m.key)}
              style={{ ...S.dropdownItem, ...(activeMetrics.includes(m.key) ? S.dropdownItemActive : {}) }}>
              <input type="checkbox" checked={activeMetrics.includes(m.key)} onChange={() => {}} style={{ accentColor: '#6366f1' }} />
              <span style={{ flex: 1 }}>{m.label}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Line chart (SVG, multi-series with hover)
// ═══════════════════════════════════════════════════════════════════
function StudioLineChart({ series, metricDef }) {
  const [hoverX, setHoverX] = useState(null);
  const svgRef = useRef(null);
  const W = 1100, H = 280, PAD = { top: 20, right: 24, bottom: 36, left: 60 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  if (!series.length || series.every(s => s.points.length === 0)) {
    return <div style={{ ...S.loadingOverlay, position: 'static', padding: 60 }}>No chart data.</div>;
  }

  // Build unified x-domain from all unique dates
  const allDates = Array.from(new Set(series.flatMap(s => s.points.map(p => p.date)))).sort();
  const xIdx = Object.fromEntries(allDates.map((d, i) => [d, i]));
  const xStep = allDates.length > 1 ? plotW / (allDates.length - 1) : plotW;

  const allValues = series.flatMap(s => s.points.map(p => p.value || 0));
  const maxVal = Math.max(...allValues, 1);
  const minVal = Math.min(...allValues, 0);
  const range = maxVal - minVal || 1;

  const yFor = (v) => PAD.top + plotH - ((v - minVal) / range) * plotH;
  const xFor = (d) => PAD.left + (xIdx[d] || 0) * xStep;

  // 5 horizontal gridlines
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map(p => {
    const v = minVal + p * range;
    return { y: yFor(v), label: formatValue(v, metricDef?.format) };
  });

  function onMove(e) {
    const rect = svgRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W - PAD.left;
    const idx = Math.round(x / xStep);
    if (idx >= 0 && idx < allDates.length) setHoverX(allDates[idx]);
  }
  function onLeave() { setHoverX(null); }

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height: 280, display: 'block' }}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
      >
        {gridLines.map((g, i) => (
          <g key={i}>
            <line x1={PAD.left} x2={W - PAD.right} y1={g.y} y2={g.y} stroke="rgba(255,255,255,0.06)" />
            <text x={PAD.left - 8} y={g.y + 4} textAnchor="end" fill="rgba(255,255,255,0.4)" fontSize="11">{g.label}</text>
          </g>
        ))}

        {/* X axis labels (first / mid / last) */}
        {allDates.length > 0 && (
          <>
            <text x={PAD.left} y={H - 12} fill="rgba(255,255,255,0.4)" fontSize="11">{formatDate(allDates[0])}</text>
            {allDates.length > 2 && (
              <text x={W / 2} y={H - 12} textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="11">
                {formatDate(allDates[Math.floor(allDates.length / 2)])}
              </text>
            )}
            <text x={W - PAD.right} y={H - 12} textAnchor="end" fill="rgba(255,255,255,0.4)" fontSize="11">
              {formatDate(allDates[allDates.length - 1])}
            </text>
          </>
        )}

        {series.map((s, si) => {
          if (s.points.length === 0) return null;
          const path = s.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(p.date)} ${yFor(p.value || 0)}`).join(' ');
          return (
            <g key={s.key}>
              <path d={path} fill="none" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? '5 4' : undefined} />
              {hoverX != null && s.points.find(p => p.date === hoverX) && (
                <circle cx={xFor(hoverX)} cy={yFor(s.points.find(p => p.date === hoverX).value || 0)} r="4" fill={s.color} />
              )}
            </g>
          );
        })}

        {hoverX != null && (
          <line x1={xFor(hoverX)} x2={xFor(hoverX)} y1={PAD.top} y2={H - PAD.bottom} stroke="rgba(255,255,255,0.2)" strokeDasharray="2 2" />
        )}
      </svg>

      {/* Legend */}
      <div style={S.legend}>
        {series.map(s => (
          <div key={s.key} style={S.legendItem}>
            <span style={{ width: 10, height: 2, background: s.color }} />
            <span>{s.label}</span>
          </div>
        ))}
      </div>

      {/* Hover tooltip */}
      {hoverX != null && (
        <div style={{ ...S.tooltip, left: '50%', transform: 'translateX(-50%)' }}>
          <div style={S.tooltipDate}>{formatDate(hoverX)}</div>
          {series.map(s => {
            const p = s.points.find(pp => pp.date === hoverX);
            return (
              <div key={s.key} style={S.tooltipRow}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color }} />
                <span style={{ flex: 1 }}>{s.label}</span>
                <span style={{ fontWeight: 600 }}>{p ? formatValue(p.value, metricDef?.format) : '—'}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Video drilldown panel
// ═══════════════════════════════════════════════════════════════════
function VideoDrilldown({ videoId, channels, dateRange, videoMeta, onClose }) {
  const [dim, setDim] = useState('traffic_source');
  const [rows, setRows] = useState([]);
  const [dailyRows, setDailyRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const dimensionDef = DIMENSIONS.find(d => d.key === dim);

  useEffect(() => {
    if (!videoId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [{ data: dimData }, { data: daily }] = await Promise.all([
          dimensionDef.videoTable
            ? supabase.from(dimensionDef.videoTable).select('*')
                .eq('video_id', videoId)
                .in('platform_account_id', channels)
                .gte('date', dateRange.start).lte('date', dateRange.end)
            : Promise.resolve({ data: [] }),
          supabase.from('yt_video_daily').select('*')
            .eq('video_id', videoId)
            .in('platform_account_id', channels)
            .gte('date', dateRange.start).lte('date', dateRange.end)
            .order('date', { ascending: true }),
        ]);
        if (cancelled) return;
        setRows(groupAndAggregate(dimData || [], r => r.dimension_value, k => k));
        setDailyRows(daily || []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [videoId, dim, channels.join(','), dateRange.start, dateRange.end, dimensionDef]);

  return (
    <div style={S.drillBackdrop} {...backdropDismiss(onClose)}>
      <div style={S.drillPanel} onClick={e => e.stopPropagation()}>
        <div style={S.drillHeader}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {videoMeta?.thumbnail_url && <img src={videoMeta.thumbnail_url} alt="" style={{ width: 120, height: 68, borderRadius: 6, objectFit: 'cover' }} />}
            <div>
              <div style={{ color: '#fff', fontWeight: 600, fontSize: 16 }}>{videoMeta?.title || videoId}</div>
              {videoMeta?.url && <a href={videoMeta.url} target="_blank" rel="noreferrer" style={{ color: '#a5b4fc', fontSize: 12 }}>Open on YouTube ↗</a>}
            </div>
          </div>
          <button onClick={onClose} style={S.closeBtn}>✕</button>
        </div>

        <div style={S.drillTabs}>
          {DIMENSIONS.filter(d => d.videoTable).map(d => (
            <button key={d.key} onClick={() => setDim(d.key)}
              style={{ ...S.drillTab, ...(dim === d.key ? S.drillTabActive : {}) }}>
              {d.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <div style={S.drillSubtitle}>Daily totals</div>
            <table style={S.table}>
              <thead><tr>
                <th style={S.th}>Date</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Views</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Watch hrs</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Avg duration</th>
              </tr></thead>
              <tbody>
                {dailyRows.map(r => (
                  <tr key={r.id || r.date}>
                    <td style={S.td}>{formatDate(r.date)}</td>
                    <td style={{ ...S.td, textAlign: 'right' }}>{formatValue(r.views, 'compact')}</td>
                    <td style={{ ...S.td, textAlign: 'right' }}>{formatValue(r.watch_time_minutes, 'hours')}</td>
                    <td style={{ ...S.td, textAlign: 'right' }}>{formatValue(r.average_view_duration_seconds, 'duration')}</td>
                  </tr>
                ))}
                {dailyRows.length === 0 && !loading && (
                  <tr><td colSpan={4} style={{ ...S.td, textAlign: 'center', color: 'rgba(255,255,255,0.3)' }}>No daily data.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div>
            <div style={S.drillSubtitle}>{dimensionDef.label}</div>
            <table style={S.table}>
              <thead><tr>
                <th style={S.th}>{dimensionDef.label}</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Views</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Watch hrs</th>
              </tr></thead>
              <tbody>
                {[...rows].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 50).map((r) => (
                  <tr key={r._key}>
                    <td style={S.td}>{r._label || r._key}</td>
                    <td style={{ ...S.td, textAlign: 'right' }}>{formatValue(r.views, 'compact')}</td>
                    <td style={{ ...S.td, textAlign: 'right' }}>{formatValue(r.watch_time_minutes, 'hours')}</td>
                  </tr>
                ))}
                {rows.length === 0 && !loading && (
                  <tr><td colSpan={3} style={{ ...S.td, textAlign: 'center', color: 'rgba(255,255,255,0.3)' }}>No data for this dimension.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════════════════════════════
const S = {
  studioHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    flexWrap: 'wrap', gap: 12,
    padding: '14px 18px', marginBottom: 12,
    background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12,
  },
  studioTitle: { color: '#fff', fontSize: 16, fontWeight: 700 },
  dateRangeLabel: { color: 'rgba(255,255,255,0.45)', fontSize: 13 },
  headerChip: {
    padding: '7px 13px', background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20,
    color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: 500,
    cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6,
  },
  headerChipActive: {
    background: 'rgba(99,102,241,0.18)', borderColor: 'rgba(99,102,241,0.5)', color: '#a5b4fc',
  },
  chev: { fontSize: 9, marginLeft: 2 },

  dropdown: {
    position: 'absolute', top: '100%', right: 0, marginTop: 6,
    background: '#1e1e36', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10,
    padding: 6, minWidth: 220, zIndex: 90, display: 'flex', flexDirection: 'column', gap: 2,
    boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
  },
  dropdownItem: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '8px 12px', background: 'transparent', border: '1px solid transparent', borderRadius: 8,
    color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: 500,
    cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', width: '100%',
  },
  dropdownItemActive: {
    background: 'rgba(99,102,241,0.15)', borderColor: 'rgba(99,102,241,0.4)', color: '#a5b4fc',
  },
  dropdownClear: {
    padding: '5px 12px', background: 'transparent', border: 'none',
    color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: 500, cursor: 'pointer',
    fontFamily: 'inherit', textAlign: 'left',
  },

  input: {
    padding: '6px 8px', background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6,
    color: '#fff', fontSize: 12, fontFamily: 'inherit', outline: 'none',
  },

  card: {
    background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 12, padding: 18, marginBottom: 16, position: 'relative',
  },
  loadingOverlay: {
    position: 'absolute', top: 8, right: 12, color: 'rgba(255,255,255,0.4)', fontSize: 11,
  },

  chartTabs: {
    display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap',
    borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: 12,
  },
  chartTab: {
    padding: '8px 16px', background: 'transparent',
    border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10,
    color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontFamily: 'inherit',
    textAlign: 'left', minWidth: 140,
  },
  chartTabActive: {
    background: 'rgba(99,102,241,0.12)', borderColor: 'rgba(99,102,241,0.5)', color: '#a5b4fc',
  },
  chartTabLabel: { fontSize: 11, fontWeight: 500, color: 'rgba(255,255,255,0.5)' },
  chartTabValue: { fontSize: 18, fontWeight: 700, color: '#fff', marginTop: 4, fontVariantNumeric: 'tabular-nums' },

  legend: { display: 'flex', flexWrap: 'wrap', gap: 12, padding: '8px 0', justifyContent: 'center' },
  legendItem: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'rgba(255,255,255,0.6)' },

  tooltip: {
    position: 'absolute', top: 20, background: 'rgba(18,18,31,0.95)',
    border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8,
    padding: '10px 14px', minWidth: 220, zIndex: 10, pointerEvents: 'none',
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
  },
  tooltipDate: { fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 6 },
  tooltipRow: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#fff', marginBottom: 4 },

  tableTopBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  dimensionBtn: {
    padding: '8px 14px', background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8,
    color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
    fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6,
  },

  tableScroll: { overflow: 'auto', maxHeight: 600, borderRadius: 8 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 700 },
  th: {
    padding: '10px 14px', textAlign: 'left', fontWeight: 600, fontSize: 11,
    color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.5px',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    position: 'sticky', top: 0, background: '#16162a', zIndex: 1,
    whiteSpace: 'nowrap', userSelect: 'none',
  },
  thSticky: { position: 'sticky', left: 0, zIndex: 3, background: '#16162a' },
  sortArrow: { marginLeft: 4, color: '#a5b4fc' },
  td: {
    padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.04)',
    color: 'rgba(255,255,255,0.7)', whiteSpace: 'nowrap',
  },
  tdSticky: { position: 'sticky', left: 0, zIndex: 1, background: '#101023' },
  tdValue: { fontWeight: 600, color: '#e2e8f0', fontVariantNumeric: 'tabular-nums' },
  tdDelta: { fontSize: 10, fontWeight: 500, marginTop: 2, fontVariantNumeric: 'tabular-nums' },
  trEven: { background: 'rgba(255,255,255,0.012)' },
  totalsRow: { background: 'rgba(99,102,241,0.06)' },

  metricGroupHeader: {
    padding: '8px 12px 4px', fontSize: 10, fontWeight: 700,
    color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px',
  },

  videoLink: {
    background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
    color: '#e2e8f0', fontFamily: 'inherit', textAlign: 'left',
    display: 'inline-flex', alignItems: 'center', gap: 8, maxWidth: '100%',
  },
  thumb: { width: 56, height: 32, borderRadius: 4, objectFit: 'cover', flexShrink: 0 },

  emptyCard: {
    background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.08)',
    borderRadius: 14, padding: 32, textAlign: 'center', marginBottom: 20,
  },
  emptyText: { color: 'rgba(255,255,255,0.4)', fontSize: 14, margin: 0 },

  savedPanel: {
    display: 'flex', flexWrap: 'wrap', gap: 6, padding: '10px 14px', marginBottom: 12,
    background: 'rgba(99,102,241,0.04)', border: '1px solid rgba(99,102,241,0.15)', borderRadius: 10,
  },
  savedRow: { display: 'inline-flex', alignItems: 'center', gap: 4 },
  savedLoadBtn: {
    padding: '5px 10px', background: 'rgba(99,102,241,0.12)',
    border: '1px solid rgba(99,102,241,0.3)', borderRadius: 14,
    color: '#a5b4fc', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
  },
  savedDelBtn: {
    padding: '5px 7px', background: 'transparent', border: 'none',
    color: 'rgba(255,255,255,0.3)', cursor: 'pointer', fontSize: 12,
  },

  drillBackdrop: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
  },
  drillPanel: {
    background: '#0f0f1a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14,
    padding: 24, width: 'min(1200px, 95vw)', maxHeight: '90vh', overflow: 'auto',
  },
  drillHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    marginBottom: 18, paddingBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  drillTabs: {
    display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 16,
    padding: 4, background: 'rgba(255,255,255,0.03)', borderRadius: 8,
  },
  drillTab: {
    padding: '6px 12px', background: 'transparent', border: 'none', borderRadius: 6,
    color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
  },
  drillTabActive: {
    background: 'rgba(99,102,241,0.18)', color: '#a5b4fc',
  },
  drillSubtitle: {
    fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.45)',
    textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8,
  },
  closeBtn: {
    background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
    color: 'rgba(255,255,255,0.6)', borderRadius: 8, padding: '6px 10px',
    cursor: 'pointer', fontFamily: 'inherit',
  },
};
