import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import useVisibilityRefresh from '../../hooks/useVisibilityRefresh';
import YouTubeStudioAdvanced from '../YouTubeStudioAdvanced';
import ContentHealthDashboard from '../ContentHealthDashboard';

import { PLATFORM_META, DATE_RANGES, MONTHS } from './constants';
import { daysAgoStr, todayStr, getDateRange, formatCompact, formatCurrency, pctChange, fetchAllRows } from './utils';
import { styles, L } from './styles';

import DonutChart from './components/DonutChart';
import DataInputSection from './components/DataInputSection';
import RPMCard from './components/RPMCard';
import PublishHeatmap from './components/PublishHeatmap';
import ContentVelocityChart from './components/ContentVelocityChart';
import FrequencyGrowthChart from './components/FrequencyGrowthChart';
import CompareView from './components/CompareView';
import WeeklyReport from './components/WeeklyReport';
import SyncHealthWidget from './components/SyncHealthWidget';
import DecisionKpiCard from './components/DecisionKpiCard';
import DataCompletenessBadge from './components/DataCompletenessBadge';
import CoverageChip from './components/CoverageChip';
import FormatPerformance from './components/FormatPerformance';
import ThisWeekBanner from './components/ThisWeekBanner';
import { MiniBar, EmptyChart, Sparkline, Skeleton } from './viz';

// Skeleton placeholder for the dashboard while first data loads — keeps the
// page shape instead of collapsing to a single "Loading…" line.
function DashboardSkeleton() {
  return (
    <div>
      <div style={styles.kpiGrid}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} style={styles.kpiCard}>
            <Skeleton height={10} width="45%" />
            <Skeleton height={26} width="70%" style={{ marginTop: 10 }} />
            <Skeleton height={10} width="55%" style={{ marginTop: 12 }} />
          </div>
        ))}
      </div>
      <div style={styles.kpiGrid}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} style={styles.kpiCard}><Skeleton height={70} /></div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} style={{ ...styles.chartSection, flex: '1 1 340px', minWidth: '300px' }}>
            <Skeleton height={160} />
          </div>
        ))}
      </div>
    </div>
  );
}

// Platforms the Dashboard top section + Weekly digest focus on, in display order.
const DIGEST_PLATFORMS = ['youtube', 'tiktok', 'instagram', 'substack', 'simplecast'];

// Tailored metric set per platform (label, value) — driven off the digestPlatforms memo.
const DIGEST_CARD_METRICS = {
  youtube: d => [
    ['Views', formatCompact(d.views)],
    ['Subs', `${d.gained >= 0 ? '+' : ''}${formatCompact(d.gained)}`],
    ['Watch', `${formatCompact(Math.round(d.watchHours))} h`],
    ['Revenue', `$${(d.revenueCents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`],
  ],
  tiktok: d => [
    ['Views', formatCompact(d.views)],
    ['Followers', formatCompact(d.followers)],
    ['Likes', formatCompact(d.likes)],
  ],
  instagram: d => [
    ['Views', formatCompact(d.views)],
    ['Followers', formatCompact(d.followers)],
    ['Engagement', formatCompact(d.engagement)],
  ],
  substack: d => [
    ['Posts', formatCompact(d.posts)],
    ['Subscribers', formatCompact(d.followers)],
  ],
  simplecast: d => [
    ['Downloads', formatCompact(d.views)],
  ],
};

export default function Analytics() {
  const { profile, isAdmin, refreshKey } = useAuth();

  // Filters
  const [dateRange, setDateRange] = useState('30d');
  const [customStart, setCustomStart] = useState(daysAgoStr(30));
  const [customEnd, setCustomEnd] = useState(todayStr());
  const [filterMonth, setFilterMonth] = useState(new Date().getMonth());
  const [filterYear, setFilterYear] = useState(new Date().getFullYear());
  const [activeAccountIds, setActiveAccountIds] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [platformDropdownOpen, setPlatformDropdownOpen] = useState(false);
  const [timeDropdownOpen, setTimeDropdownOpen] = useState(false);
  const [contentRefreshing, setContentRefreshing] = useState(false);
  const platformDropdownRef = useRef(null);
  const timeDropdownRef = useRef(null);

  // Data
  const [timeSeries, setTimeSeries] = useState([]);
  const [kpiSummary, setKpiSummary] = useState(null);
  // Substack paid subscribers live in audience_snapshots.metadata.supporters
  // (manually entered via Data Input), not in the rollup — fetched separately.
  const [substackPaid, setSubstackPaid] = useState(null);
  const [contentItems, setContentItems] = useState([]);
  const [loading, setLoading] = useState(true);

  // Content table sort
  const [sortCol, setSortCol] = useState('outperformance');
  const [sortDir, setSortDir] = useState('desc');

  // CSV upload (preserved)
  const [csvSection, setCsvSection] = useState(false);

  // Content performance (collapsible)
  const [showContentPerf, setShowContentPerf] = useState(false);
  // Platform digest strip (collapsible under KPIs)
  const [showDigest, setShowDigest] = useState(false);

  const [viewMode, setViewMode] = useState('dashboard');

  // Analysis tools
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [analysisData, setAnalysisData] = useState({ revenue: [], contentWithMetrics: [], audienceSnapshots: [] });

  // Platform sync refresh
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null);
  const syncStatusTimeoutRef = useRef(null);

  // Generation refs: each in-flight fetch captures its gen at call-start.
  // If gen drifts (filters changed, another fetch started), the late response
  // no-ops instead of clobbering current state. One ref per fetch so that
  // refreshing content doesn't invalidate in-flight KPI/time-series fetches.
  const allDataGenRef = useRef(0);
  const timeSeriesGenRef = useRef(0);
  const contentGenRef = useRef(0);
  const analysisGenRef = useRef(0);
  const kpiGenRef = useRef(0);

  // Clear any pending syncStatus timer on unmount
  useEffect(() => () => {
    if (syncStatusTimeoutRef.current) clearTimeout(syncStatusTimeoutRef.current);
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e) {
      if (platformDropdownRef.current && !platformDropdownRef.current.contains(e.target)) {
        setPlatformDropdownOpen(false);
      }
      if (timeDropdownRef.current && !timeDropdownRef.current.contains(e.target)) {
        setTimeDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Label shown on the time-range pill button.
  function timeRangeLabel() {
    if (dateRange === 'lifetime') return 'Lifetime';
    if (dateRange === 'custom') return 'Custom';
    if (dateRange === 'month') return `${MONTHS[filterMonth]} ${filterYear}`;
    if (dateRange === 'year') return `${filterYear}`;
    return DATE_RANGES.find(r => r.key === dateRange)?.label || 'Time range';
  }

  // ── Fetch platform accounts ──
  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('platform_accounts')
        .select('*')
        .eq('is_active', true)
        .order('platform');
      if (data) setAccounts(data);
    }
    load();
  }, []);

  // ── Latest Substack paid (supporters) for the digest card ──
  useEffect(() => {
    const acct = accounts.find(a => a.platform === 'substack');
    if (!acct) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('audience_snapshots')
        .select('metadata, date')
        .eq('platform_account_id', acct.id)
        .order('date', { ascending: false })
        .limit(30);
      const row = (data || []).find(r => r.metadata && r.metadata.supporters != null);
      if (!cancelled) setSubstackPaid(row ? Number(row.metadata.supporters) : null);
    })();
    return () => { cancelled = true; };
  }, [accounts]);

  // ── Fetch all data when filters change ──
  const fetchAllData = useCallback(async () => {
    const gen = ++allDataGenRef.current;
    setLoading(true);
    try {
      await Promise.all([
        fetchTimeSeries(),
        fetchContentPerformance(),
        fetchAnalysisData(),
        fetchKpiSummary(),
      ]);
    } catch (err) {
      console.error('Error fetching analytics:', err);
    } finally {
      if (gen === allDataGenRef.current) setLoading(false);
    }
  }, [dateRange, customStart, customEnd, filterMonth, filterYear, activeAccountIds]);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);
  useVisibilityRefresh(fetchAllData);

  // Auto-refresh content performance every 5 minutes
  useEffect(() => {
    const interval = setInterval(() => {
      fetchContentPerformance();
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [dateRange, customStart, customEnd, filterMonth, filterYear, activeAccountIds.join(',')]);

  async function handleContentRefresh() {
    setContentRefreshing(true);
    try {
      await fetchContentPerformance();
    } finally {
      setContentRefreshing(false);
    }
  }

  async function handleSyncAllPlatforms() {
    setSyncing(true);
    setSyncStatus(null);
    const base = process.env.REACT_APP_SUPABASE_URL;
    const anonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
    const headers = { 'Authorization': `Bearer ${anonKey}`, 'Content-Type': 'application/json' };
    try {
      const results = await Promise.allSettled([
        fetch(`${base}/functions/v1/sync-metricool`, { method: 'POST', headers }),
        fetch(`${base}/functions/v1/sync-twitch`, { method: 'POST', headers }),
      ]);
      const failures = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.ok));
      // Refresh materialized view
      await supabase.rpc('refresh_daily_platform_rollups');
      // Re-fetch all dashboard data
      await fetchAllData();
      setSyncStatus(failures.length > 0 ? `Synced with ${failures.length} warning(s)` : 'All platforms synced!');
    } catch (err) {
      console.error('Sync error:', err);
      setSyncStatus('Sync failed — check console');
    } finally {
      setSyncing(false);
      if (syncStatusTimeoutRef.current) clearTimeout(syncStatusTimeoutRef.current);
      syncStatusTimeoutRef.current = setTimeout(() => {
        setSyncStatus(null);
        syncStatusTimeoutRef.current = null;
      }, 5000);
    }
  }

  // Decision-row KPIs: current window + previous-equal-length window + trailing-
  // 4-window average for views, posts, followers gained, and (complete) revenue.
  async function fetchKpiSummary() {
    const gen = ++kpiGenRef.current;
    const { start, end } = getDateRange(dateRange, customStart, customEnd, filterMonth, filterYear);
    const { data, error } = await supabase.rpc('get_kpi_summary', {
      p_start: start,
      p_end: end,
      p_account_ids: activeAccountIds.length > 0 ? activeAccountIds : null,
    });
    if (gen !== kpiGenRef.current) return;
    if (error) { console.error('get_kpi_summary error:', error); setKpiSummary(null); return; }
    setKpiSummary(data);
  }

  async function fetchAnalysisData() {
    const gen = ++analysisGenRef.current;
    const { start, end } = getDateRange(dateRange, customStart, customEnd, filterMonth, filterYear);
    const [revResult, contentResult, audResult] = await Promise.all([
      supabase
        .from('revenue_events')
        .select('platform_account_id, amount_cents, net_amount_cents, event_type')
        .gte('occurred_at', start)
        .lte('occurred_at', end + 'T23:59:59.999')
        .in('event_type', ['charge', 'subscription_renewal']),
      supabase
        .from('content_items')
        .select('id, title, published_at, platform_account_id, url, content_type, series, platform_account:platform_accounts(platform, account_name), latest_metrics:content_metrics(views, likes, comments, shares, engagement_rate)')
        .gte('published_at', start)
        .lte('published_at', end + 'T23:59:59.999')
        .order('published_at', { ascending: false })
        .limit(500),
      supabase
        .from('audience_snapshots')
        .select('date, followers_gained, platform_account_id')
        .gte('date', start)
        .lte('date', end),
    ]);
    if (gen !== analysisGenRef.current) return;
    setAnalysisData({
      revenue: revResult.data || [],
      contentWithMetrics: contentResult.data || [],
      audienceSnapshots: audResult.data || [],
    });
  }


  async function fetchTimeSeries() {
    const gen = ++timeSeriesGenRef.current;
    const { start, end } = getDateRange(dateRange, customStart, customEnd, filterMonth, filterYear);
    let q = supabase
      .from('daily_platform_rollups')
      .select('*')
      .gte('date', start)
      .lte('date', end)
      .order('date', { ascending: true });
    if (activeAccountIds.length > 0) q = q.in('platform_account_id', activeAccountIds);
    const data = await fetchAllRows(q);
    if (gen !== timeSeriesGenRef.current) return;
    setTimeSeries(data);
  }

  async function fetchContentPerformance() {
    const gen = ++contentGenRef.current;
    const { start, end } = getDateRange(dateRange, customStart, customEnd, filterMonth, filterYear);
    let q = supabase
      .from('content_items')
      .select(`
        *,
        platform_account:platform_accounts(platform, account_name),
        latest_metrics:content_metrics(views, likes, comments, shares, engagement_rate)
      `)
      .gte('published_at', start)
      .lte('published_at', end)
      .order('published_at', { ascending: false })
      .limit(100);
    if (activeAccountIds.length > 0) q = q.in('platform_account_id', activeAccountIds);
    const { data } = await q;
    if (gen !== contentGenRef.current) return;
    setContentItems(data || []);
  }

  // ── Toggle account filter ──
  function toggleAccount(accountId) {
    setActiveAccountIds(prev => {
      if (prev.includes(accountId)) return prev.filter(id => id !== accountId);
      return [...prev, accountId];
    });
  }


  // ── Account breakdowns for donuts ──
  const platformBreakdown = useMemo(() => {
    const byAccount = {};
    for (const row of timeSeries) {
      const key = row.platform_account_id;
      if (!byAccount[key]) byAccount[key] = { views: 0, revenue: 0, engagement: 0, followers: 0, _engCount: 0, platform: row.platform, name: row.account_name };
      byAccount[key].views += Number(row.total_views) || 0;
      byAccount[key].revenue += Number(row.revenue_cents) || 0;
      const eng = Number(row.avg_engagement_rate) || 0;
      if (eng > 0) { byAccount[key].engagement += eng; byAccount[key]._engCount += 1; }
      const fol = Number(row.followers_eod) || 0;
      if (fol > 0) byAccount[key].followers = fol;
    }
    return Object.entries(byAccount)
      .map(([id, info]) => ({
        platform: info.platform,
        views: info.views,
        revenue: info.revenue,
        engagement: info._engCount > 0 ? info.engagement / info._engCount : 0,
        followers: info.followers,
        color: PLATFORM_META[info.platform]?.color || '#666',
        label: info.name || PLATFORM_META[info.platform]?.label || info.platform,
      }))
      .sort((a, b) => b.views - a.views);
  }, [timeSeries]);

  // ── Per-platform digest cards (top of dashboard) — the Weekly-digest platforms ──
  const digestPlatforms = useMemo(() => {
    const by = {};
    for (const row of timeSeries) {
      const p = row.platform;
      if (!DIGEST_PLATFORMS.includes(p)) continue;
      if (!by[p]) by[p] = { views: 0, likes: 0, comments: 0, shares: 0, watch: 0, posts: 0, revenue: 0, gained: 0, _fol: {} };
      const b = by[p];
      b.views += Number(row.total_views) || 0;
      b.likes += Number(row.total_likes) || 0;
      b.comments += Number(row.total_comments) || 0;
      b.shares += Number(row.total_shares) || 0;
      b.watch += Number(row.total_watch_time_seconds) || 0;
      b.posts += Number(row.posts_published) || 0;
      b.revenue += Number(row.revenue_cents) || 0;
      b.gained += Number(row.followers_gained) || 0;
      // followers_eod is a daily snapshot — keep the latest per account, then sum across accounts.
      const cur = b._fol[row.platform_account_id];
      if (!cur || row.date > cur.date) b._fol[row.platform_account_id] = { date: row.date, val: Number(row.followers_eod) || 0 };
    }
    return DIGEST_PLATFORMS.map(p => {
      const b = by[p];
      const followers = b ? Object.values(b._fol).reduce((s, f) => s + f.val, 0) : 0;
      return {
        platform: p,
        hasData: !!b,
        views: b ? b.views : 0,
        likes: b ? b.likes : 0,
        engagement: b ? b.likes + b.comments + b.shares : 0,
        watchHours: b ? b.watch / 3600 : 0,
        posts: b ? b.posts : 0,
        revenueCents: b ? b.revenue : 0,
        gained: b ? b.gained : 0,
        followers,
      };
    });
  }, [timeSeries]);

  // ── Daily series for KPI sparklines (shape behind each headline number) ──
  const kpiSparks = useMemo(() => {
    const byDate = {};
    for (const row of timeSeries) {
      const d = row.date;
      if (!byDate[d]) byDate[d] = { views: 0, posts: 0, gained: 0, revenue: 0 };
      byDate[d].views += Number(row.total_views) || 0;
      byDate[d].posts += Number(row.posts_published) || 0;
      byDate[d].gained += Number(row.followers_gained) || 0;
      byDate[d].revenue += Number(row.revenue_cents) || 0;
    }
    const dates = Object.keys(byDate).sort();
    return {
      views: dates.map(d => byDate[d].views),
      efficiency: dates.map(d => (byDate[d].posts > 0 ? byDate[d].views / byDate[d].posts : 0)),
      audience: dates.map(d => byDate[d].gained),
      revenue: dates.map(d => byDate[d].revenue / 100),
    };
  }, [timeSeries]);

  // ── Per-platform daily views for the digest-card sparklines ──
  const platformViewSpark = useMemo(() => {
    const by = {};
    for (const row of timeSeries) {
      const p = row.platform;
      if (!DIGEST_PLATFORMS.includes(p)) continue;
      by[p] = by[p] || {};
      by[p][row.date] = (by[p][row.date] || 0) + (Number(row.total_views) || 0);
    }
    const out = {};
    for (const p of DIGEST_PLATFORMS) {
      out[p] = by[p] ? Object.keys(by[p]).sort().map(d => by[p][d]) : [];
    }
    return out;
  }, [timeSeries]);

  // ── Decision-row KPIs (Reach / Efficiency / Audience velocity / Revenue) ──
  const decisionCards = useMemo(() => {
    if (!kpiSummary?.current) return null;
    const cur = kpiSummary.current, prev = kpiSummary.prev || {}, base = kpiSummary.base4 || {};
    const n = (v) => Number(v) || 0;
    const perPost = (views, posts) => (n(posts) > 0 ? n(views) / n(posts) : 0);
    const rpm = (cents, views) => (n(views) > 0 ? (n(cents) / 100) / (n(views) / 1000) : 0);
    const curVPP = perPost(cur.views, cur.posts);
    const topViews = platformBreakdown.filter(p => p.views > 0)[0];
    return {
      reach: {
        value: formatCompact(n(cur.views)),
        soWhat: topViews ? `Top: ${topViews.label} (${formatCompact(topViews.views)})` : null,
        deltaPrev: pctChange(n(cur.views), n(prev.views)),
        deltaBase: pctChange(n(cur.views), n(base.views)),
      },
      efficiency: {
        value: formatCompact(curVPP),
        soWhat: `${n(cur.posts).toLocaleString()} posts published`,
        deltaPrev: pctChange(curVPP, perPost(prev.views, prev.posts)),
        deltaBase: pctChange(curVPP, perPost(base.views, base.posts)),
      },
      audience: {
        value: `${n(cur.followers_gained) >= 0 ? '+' : ''}${formatCompact(n(cur.followers_gained))}`,
        soWhat: `net followers over ${kpiSummary.window?.len_days || 0}d`,
        deltaPrev: pctChange(n(cur.followers_gained), n(prev.followers_gained)),
        deltaBase: pctChange(n(cur.followers_gained), n(base.followers_gained)),
      },
      revenue: {
        value: formatCurrency(n(cur.revenue_cents)),
        soWhat: `Blended RPM $${rpm(cur.revenue_cents, cur.views).toFixed(2)}/1K`,
        deltaPrev: pctChange(n(cur.revenue_cents), n(prev.revenue_cents)),
        deltaBase: pctChange(n(cur.revenue_cents), n(base.revenue_cents)),
      },
    };
  }, [kpiSummary, platformBreakdown]);

  // ── Score each post vs its platform's median views (efficiency lens) ──
  const scoredContent = useMemo(() => {
    const viewsOf = (it) => Number(it.latest_metrics?.[0]?.views) || 0;
    const byPlatform = {};
    for (const it of contentItems) {
      const p = it.platform_account?.platform || 'unknown';
      const v = viewsOf(it);
      if (v > 0) (byPlatform[p] = byPlatform[p] || []).push(v);
    }
    const medians = {};
    for (const [p, arr] of Object.entries(byPlatform)) {
      const s = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      medians[p] = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    }
    return contentItems.map((it) => {
      const p = it.platform_account?.platform || 'unknown';
      const med = medians[p] || 0;
      const vsMedian = med > 0 ? viewsOf(it) / med : null;
      let flag = null;
      if (vsMedian != null && vsMedian >= 2) flag = 'hot';
      else if (vsMedian != null && vsMedian <= 0.33) flag = 'cold';
      return { ...it, _vsMedian: vsMedian, _flag: flag };
    });
  }, [contentItems]);

  // ── Sort content items ──
  const sortedContent = useMemo(() => {
    return [...scoredContent].sort((a, b) => {
      let va, vb;
      if (sortCol === 'outperformance') {
        va = a._vsMedian ?? -1;
        vb = b._vsMedian ?? -1;
      } else if (sortCol === 'views' || sortCol === 'engagement_rate') {
        const aMetrics = a.latest_metrics?.[0] || {};
        const bMetrics = b.latest_metrics?.[0] || {};
        va = aMetrics[sortCol] || 0;
        vb = bMetrics[sortCol] || 0;
      } else if (sortCol === 'platform') {
        va = a.platform_account?.platform || '';
        vb = b.platform_account?.platform || '';
      } else {
        va = a[sortCol] ?? '';
        vb = b[sortCol] ?? '';
      }
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortDir === 'asc' ? va - vb : vb - va;
    });
  }, [scoredContent, sortCol, sortDir]);

  // Max views across the table so each row's inline bar is comparable.
  const maxTableViews = useMemo(
    () => Math.max(1, ...scoredContent.map(it => Number(it.latest_metrics?.[0]?.views) || 0)),
    [scoredContent],
  );

  function handleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('desc'); }
  }

  // Accessible sortable header: keyboard-activatable + aria-sort for screen readers.
  function renderSortTh(col, label, opts = {}) {
    const active = sortCol === col;
    const ariaSort = active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';
    return (
      <th scope="col" role="columnheader" tabIndex={0} aria-sort={ariaSort} title={opts.title}
        onClick={() => handleSort(col)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSort(col); } }}
        style={{ ...styles.th, ...(opts.sticky ? styles.thSticky : {}), ...(opts.align === 'right' ? { textAlign: 'right' } : {}), cursor: 'pointer' }}>
        {label} {active && <span style={styles.sortArrow}>{sortDir === 'asc' ? '↑' : '↓'}</span>}
      </th>
    );
  }

  return (
    <div style={styles.page}>
      {/* ── Top Bar ── */}
      <div style={styles.topBar}>
        <div>
          <h1 style={styles.pageTitle}>Analytics Command Center</h1>
          <p style={styles.pageSubtitle}>Multi-platform performance dashboard</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {syncStatus && (
            <span style={{ fontSize: '12px', color: syncStatus.includes('failed') || syncStatus.includes('warning') ? '#c98a2b' : L.pos, fontWeight: 600 }}>
              {syncStatus}
            </span>
          )}
          <button
            onClick={handleSyncAllPlatforms}
            disabled={syncing}
            style={{
              padding: '8px 16px', borderRadius: '8px', border: 'none',
              background: L.accent,
              color: '#ffffff', fontSize: '13px', fontWeight: 600, cursor: syncing ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: '6px',
              opacity: syncing ? 0.6 : 1, transition: 'all 0.15s', boxShadow: L.shadowSm,
            }}
          >
            <span style={{ display: 'inline-block', animation: syncing ? 'spin 1s linear infinite' : 'none' }}>↻</span>
            {syncing ? 'Syncing...' : 'Refresh All'}
          </button>
        </div>
      </div>

      {/* ── View Mode Toggle + Dashboard filters (time pill + platforms pill) ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '24px' }}>
        <div style={{ ...styles.viewToggleBar, marginBottom: 0 }}>
          <button onClick={() => setViewMode('dashboard')} style={viewMode === 'dashboard' ? styles.viewToggleBtnActive : styles.viewToggleBtn}>Dashboard</button>
          <button onClick={() => setViewMode('compare')} style={viewMode === 'compare' ? styles.viewToggleBtnActive : styles.viewToggleBtn}>Compare</button>
          <button onClick={() => setViewMode('weekly')} style={viewMode === 'weekly' ? styles.viewToggleBtnActive : styles.viewToggleBtn}>Weekly Report</button>
          <button onClick={() => setViewMode('advanced')} style={viewMode === 'advanced' ? styles.viewToggleBtnActive : styles.viewToggleBtn}>Advanced</button>
          <button onClick={() => setViewMode('health')} style={viewMode === 'health' ? styles.viewToggleBtnActive : styles.viewToggleBtn}>Content Health</button>
        </div>

        {viewMode !== 'advanced' && viewMode !== 'compare' && viewMode !== 'weekly' && (
          <>
            {/* Time range pill dropdown — just right of the tabs bar */}
            <div ref={timeDropdownRef} style={{ position: 'relative' }}>
              <button onClick={() => setTimeDropdownOpen(o => !o)}
                style={{ ...styles.filterChip, display: 'flex', alignItems: 'center', gap: '6px' }}>
                {timeRangeLabel()}
                <span style={{ fontSize: '10px', marginLeft: '2px' }}>{timeDropdownOpen ? '▲' : '▼'}</span>
              </button>
              {timeDropdownOpen && (
                <div style={{ ...styles.platformDropdown, left: 0, right: 'auto', minWidth: '280px', padding: '10px' }}>
                  {/* Quick presets */}
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {DATE_RANGES.filter(r => r.key !== 'custom').map(r => (
                      <button key={r.key} onClick={() => setDateRange(r.key)}
                        style={{ ...styles.filterChip, ...(dateRange === r.key ? styles.filterChipActive : {}) }}>
                        {r.label}
                      </button>
                    ))}
                    <button onClick={() => setDateRange('lifetime')}
                      style={{ ...styles.filterChip, ...(dateRange === 'lifetime' ? styles.filterChipActive : {}) }}>
                      Lifetime
                    </button>
                    <button onClick={() => setDateRange('custom')}
                      style={{ ...styles.filterChip, ...(dateRange === 'custom' ? styles.filterChipActive : {}) }}>
                      Custom
                    </button>
                  </div>

                  {/* Month / Year */}
                  <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                    <select value={dateRange === 'month' ? filterMonth : ''}
                      onChange={e => { setDateRange('month'); setFilterMonth(Number(e.target.value)); }}
                      style={{ ...styles.filterSelect, ...(dateRange === 'month' ? styles.filterSelectActive : {}) }}>
                      <option value="" disabled>Month</option>
                      {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
                    </select>
                    <select value={dateRange === 'year' || dateRange === 'month' ? filterYear : ''}
                      onChange={e => { if (dateRange !== 'month') setDateRange('year'); setFilterYear(Number(e.target.value)); }}
                      style={{ ...styles.filterSelect, ...(dateRange === 'year' || dateRange === 'month' ? styles.filterSelectActive : {}) }}>
                      <option value="" disabled>Year</option>
                      {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map(y => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>
                  </div>

                  {/* Custom dates */}
                  {dateRange === 'custom' && (
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '8px', flexWrap: 'wrap' }}>
                      <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} style={styles.filterInput} />
                      <span style={{ color: L.inkSubtle }}>to</span>
                      <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} style={styles.filterInput} />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Platform dropdown — just right of the time pill */}
            <div ref={platformDropdownRef} style={{ position: 'relative' }}>
              <button onClick={() => setPlatformDropdownOpen(!platformDropdownOpen)}
                style={{ ...styles.filterChip, display: 'flex', alignItems: 'center', gap: '6px' }}>
                Platforms
                {activeAccountIds.length > 0 && (
                  <span style={{ background: L.accentSoft, padding: '1px 6px', borderRadius: '8px', fontSize: '10px', fontWeight: 700, color: L.accentText }}>
                    {activeAccountIds.length}
                  </span>
                )}
                <span style={{ fontSize: '10px', marginLeft: '2px' }}>{platformDropdownOpen ? '▲' : '▼'}</span>
              </button>
              {platformDropdownOpen && (
                <div style={styles.platformDropdown}>
                  {activeAccountIds.length > 0 && (
                    <button onClick={() => setActiveAccountIds([])} style={styles.platformDropdownClear}>
                      Clear all
                    </button>
                  )}
                  {accounts.map(acct => {
                    const meta = PLATFORM_META[acct.platform] || { label: acct.platform, color: '#666', icon: '?' };
                    const isActive = activeAccountIds.length === 0 || activeAccountIds.includes(acct.id);
                    return (
                      <button key={acct.id} onClick={() => toggleAccount(acct.id)}
                        style={{
                          ...styles.platformDropdownItem,
                          ...(isActive
                            ? { background: meta.color + '18', borderColor: meta.color + '55', color: meta.color }
                            : {}),
                        }}>
                        <span style={{ ...styles.platformDot, background: meta.color, opacity: isActive ? 1 : 0.35 }} />
                        <span style={{ flex: 1 }}>{acct.account_name}</span>
                        {(activeAccountIds.includes(acct.id)) && (
                          <span style={{ fontSize: '12px', color: meta.color }}>✓</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {viewMode === 'compare' && (
        <CompareView accounts={accounts} />
      )}

      {viewMode === 'weekly' && (
        <WeeklyReport />
      )}

      {viewMode === 'advanced' && (
        <YouTubeStudioAdvanced accounts={accounts} />
      )}

      {viewMode === 'health' && (
        <ContentHealthDashboard accounts={accounts} />
      )}

      {viewMode === 'dashboard' && (loading ? <DashboardSkeleton /> : (
        <>
          {/* ── ZONE 1 · This Week ── */}
          <section style={styles.zone}>
            <div style={styles.zoneHead}>
              <h2 style={styles.zoneTitle}>This Week</h2>
              <span style={styles.zoneSub}>narrative summary · data health</span>
            </div>
            <ThisWeekBanner onOpenFullReport={() => setViewMode('weekly')} />
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '14px', alignItems: 'center' }}>
              <DataCompletenessBadge />
              {isAdmin && <SyncHealthWidget />}
            </div>
          </section>

          {/* ── ZONE 2 · Key Performance ── */}
          {decisionCards && (
            <section style={styles.zone}>
              <div style={styles.zoneHead}>
                <h2 style={styles.zoneTitle}>Key Performance</h2>
                <span style={styles.zoneSub}>vs previous period · trailing 4-window average</span>
              </div>
              <div style={styles.kpiGrid}>
                <DecisionKpiCard label="Reach (views)" value={decisionCards.reach.value}
                  soWhat={decisionCards.reach.soWhat} spark={kpiSparks.views}
                  deltaPrev={decisionCards.reach.deltaPrev} deltaBase={decisionCards.reach.deltaBase} color="#3d6ea5" />
                <DecisionKpiCard label="Efficiency (views / post)" value={decisionCards.efficiency.value}
                  soWhat={decisionCards.efficiency.soWhat} spark={kpiSparks.efficiency}
                  deltaPrev={decisionCards.efficiency.deltaPrev} deltaBase={decisionCards.efficiency.deltaBase} color="#2f8f5b" />
                <DecisionKpiCard label="Audience velocity" value={decisionCards.audience.value}
                  soWhat={decisionCards.audience.soWhat} spark={kpiSparks.audience}
                  deltaPrev={decisionCards.audience.deltaPrev} deltaBase={decisionCards.audience.deltaBase} color="#a4548b" />
                <DecisionKpiCard label="Revenue" value={decisionCards.revenue.value}
                  soWhat={decisionCards.revenue.soWhat} spark={kpiSparks.revenue}
                  deltaPrev={decisionCards.revenue.deltaPrev} deltaBase={decisionCards.revenue.deltaBase} color="#c98a2b" />
              </div>

              {/* Platform digest — secondary, collapsed by default */}
              <div style={{ marginTop: '18px' }}>
                <button onClick={() => setShowDigest(!showDigest)} style={styles.collapseBtn} aria-expanded={showDigest}>
                  {showDigest ? '▾' : '▸'} By platform ({digestPlatforms.filter(d => d.hasData).length})
                </button>
                {showDigest && (
                  <div style={{ ...styles.kpiGrid, marginTop: '14px' }}>
                    {digestPlatforms.map(d => {
                      const meta = PLATFORM_META[d.platform] || { label: d.platform, color: '#666' };
                      const metrics = (DIGEST_CARD_METRICS[d.platform] || (() => []))(d);
                      if (d.platform === 'substack' && substackPaid != null) metrics.push(['Paid', formatCompact(substackPaid)]);
                      return (
                        <div key={d.platform} style={{
                          background: L.card, border: `1px solid ${L.border}`,
                          borderLeft: `3px solid ${meta.color}`, borderRadius: 12, padding: '14px 16px', boxShadow: L.shadowSm,
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                            <span style={{ width: 9, height: 9, borderRadius: '50%', background: meta.color, flexShrink: 0 }} />
                            <span style={{ fontSize: 13, fontWeight: 700, color: L.ink }}>{meta.label}</span>
                            <CoverageChip platform={d.platform} style={{ marginLeft: 'auto' }} />
                          </div>
                          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 20px' }}>
                              {metrics.map(([label, value]) => (
                                <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                  <span style={{ fontSize: 16, fontWeight: 700, color: L.ink, fontVariantNumeric: 'tabular-nums' }}>{d.hasData ? value : '—'}</span>
                                  <span style={{ fontSize: 10, color: L.inkSubtle, textTransform: 'uppercase', letterSpacing: '.4px' }}>{label}</span>
                                </div>
                              ))}
                            </div>
                            {d.hasData && (platformViewSpark[d.platform] || []).length >= 2 && (
                              <div style={{ flexShrink: 0 }} title="Daily views trend">
                                <Sparkline data={platformViewSpark[d.platform]} color={meta.color} width={72} height={24} />
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
          )}

          {/* ── ZONE 3 · Platform Breakdown ── */}
          <section style={styles.zone}>
            <div style={styles.zoneHead}>
              <h2 style={styles.zoneTitle}>Platform Breakdown</h2>
              <span style={styles.zoneSub}>where reach, engagement &amp; revenue come from</span>
            </div>
            {platformBreakdown.length === 0 ? (
              <EmptyChart label="No platform breakdown for this range yet." />
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
                {/* Views */}
                {platformBreakdown.some(p => p.views > 0) && (
                  <div style={{ ...styles.chartSection, borderTop: '3px solid #3d6ea5' }}>
                    <span style={{ ...styles.chartTitle, color: '#2f5c8a' }}>Views by Platform</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '24px', marginTop: '16px', flexWrap: 'wrap' }}>
                      <DonutChart data={platformBreakdown} valueKey="views" centerLabel="total views" />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {platformBreakdown.filter(p => p.views > 0).map(p => {
                          const total = platformBreakdown.reduce((s, x) => s + x.views, 0);
                          return (
                            <div key={p.label} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ width: '10px', height: '10px', borderRadius: '3px', background: p.color, flexShrink: 0 }} />
                              <span style={{ fontSize: '12px', color: L.inkMuted, minWidth: '70px' }}>{p.label}</span>
                              <span style={{ fontSize: '12px', fontWeight: 700, color: L.ink }}>{formatCompact(p.views)}</span>
                              <span style={{ fontSize: '10px', color: L.inkSubtle }}>({(total > 0 ? (p.views / total) * 100 : 0).toFixed(1)}%)</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
                {/* Engagement — a RATE per platform; ranked bar, not a donut. */}
                {platformBreakdown.some(p => p.engagement > 0) && (() => {
                  const engRows = platformBreakdown.filter(p => p.engagement > 0).sort((a, b) => b.engagement - a.engagement);
                  const maxEng = Math.max(...engRows.map(p => p.engagement), 0.0001);
                  return (
                    <div style={{ ...styles.chartSection, borderTop: '3px solid #2f8f5b' }}>
                      <span style={{ ...styles.chartTitle, color: '#2f8f5b' }}>Engagement Rate by Platform</span>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '16px' }}>
                        {engRows.map(p => (
                          <div key={p.label} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <span style={{ fontSize: '12px', color: L.inkMuted, minWidth: '72px', flexShrink: 0 }}>{p.label}</span>
                            <div style={{ flex: 1 }}>
                              <MiniBar value={p.engagement} max={maxEng} color={p.color} height={20} label={`${(p.engagement * 100).toFixed(2)}%`} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
                {/* Followers */}
                {platformBreakdown.some(p => p.followers > 0) && (
                  <div style={{ ...styles.chartSection, borderTop: '3px solid #a4548b' }}>
                    <span style={{ ...styles.chartTitle, color: '#a4548b' }}>Followers by Platform</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '24px', marginTop: '16px', flexWrap: 'wrap' }}>
                      <DonutChart data={platformBreakdown.filter(p => p.followers > 0)} valueKey="followers" centerLabel="total followers" />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {platformBreakdown.filter(p => p.followers > 0).map(p => {
                          const total = platformBreakdown.filter(x => x.followers > 0).reduce((s, x) => s + x.followers, 0);
                          return (
                            <div key={p.label} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ width: '10px', height: '10px', borderRadius: '3px', background: p.color, flexShrink: 0 }} />
                              <span style={{ fontSize: '12px', color: L.inkMuted, minWidth: '70px' }}>{p.label}</span>
                              <span style={{ fontSize: '12px', fontWeight: 700, color: L.ink }}>{formatCompact(p.followers)}</span>
                              <span style={{ fontSize: '10px', color: L.inkSubtle }}>({(total > 0 ? (p.followers / total) * 100 : 0).toFixed(1)}%)</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
            {/* Revenue efficiency (RPM) */}
            <div style={{ marginTop: '20px' }}>
              <RPMCard revenueData={analysisData.revenue} timeSeries={timeSeries} accounts={accounts} />
            </div>
          </section>

          {/* ── ZONE 4 · Deep Dives ── */}
          <section style={styles.zone}>
            <div style={styles.zoneHead}>
              <h2 style={styles.zoneTitle}>Deep Dives</h2>
              <span style={styles.zoneSub}>expand what you need</span>
            </div>
            <div style={{ marginBottom: '12px' }}>
            <button onClick={() => setShowContentPerf(!showContentPerf)} style={styles.collapseBtn} aria-expanded={showContentPerf}>
              {showContentPerf ? '▾' : '▸'} Content Performance ({contentItems.length})
            </button>
            {showContentPerf && (
              <>
                <div style={{ ...styles.tableHeader, marginTop: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <button onClick={handleContentRefresh} disabled={contentRefreshing}
                      style={{
                        background: 'none', border: 'none', color: L.inkSubtle, cursor: 'pointer',
                        fontSize: '16px', padding: '2px 6px', fontFamily: 'inherit', lineHeight: 1,
                        animation: contentRefreshing ? 'spin 0.8s linear infinite' : 'none',
                      }}
                      title="Refresh content performance">
                      ↻
                    </button>
                  </div>
                </div>
                {sortedContent.length > 0 ? (
                  <div style={styles.tableWrap}>
                    <table style={styles.table}>
                      <thead>
                        <tr>
                          {renderSortTh('title', 'Title', { sticky: true })}
                          {renderSortTh('platform', 'Platform')}
                          {renderSortTh('published_at', 'Date')}
                          {renderSortTh('views', 'Views', { align: 'right' })}
                          {renderSortTh('engagement_rate', 'Engagement', { align: 'right' })}
                          {renderSortTh('outperformance', 'vs median', { align: 'right', title: "Views relative to this platform's median post" })}
                        </tr>
                      </thead>
                      <tbody>
                        {sortedContent.map((item, i) => {
                          const metrics = item.latest_metrics?.[0] || {};
                          const platform = item.platform_account?.platform;
                          const meta = PLATFORM_META[platform] || {};
                          return (
                            <tr key={item.id} style={i % 2 === 0 ? styles.trEven : {}}>
                              <td style={{ ...styles.td, ...styles.tdSticky, background: i % 2 === 0 ? L.cardAlt : L.card }}>
                                {item._flag === 'hot' && <span title="Breakout: ≥2× platform median" style={{ marginRight: 6 }}>🔥</span>}
                                {item._flag === 'cold' && <span title="Underperformer: ≤0.33× platform median" style={{ marginRight: 6 }}>⚠️</span>}
                                {item.url ? (
                                  <a href={item.url} target="_blank" rel="noopener noreferrer"
                                    style={{ color: L.accentText, textDecoration: 'none', fontWeight: 600 }}>
                                    {item.title || '(Untitled)'}
                                  </a>
                                ) : (item.title || '(Untitled)')}
                              </td>
                              <td style={styles.td}>
                                <span style={{
                                  display: 'inline-block', padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 600,
                                  background: (meta.color || '#666') + '22', color: meta.color || '#999',
                                }}>
                                  {(() => {
                                    const label = meta.label || platform;
                                    const acctName = item.platform_account?.account_name;
                                    if (acctName && acctName !== label && acctName.trim()) return `${label} · ${acctName}`;
                                    return label;
                                  })()}
                                </span>
                              </td>
                              <td style={styles.td}>
                                {item.published_at ? new Date(item.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                              </td>
                              <td style={{ ...styles.td, textAlign: 'right' }}>
                                {metrics.views != null ? (
                                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                                    <span style={{ ...styles.tdValue }}>{formatCompact(Number(metrics.views))}</span>
                                    <div style={{ width: 70 }}>
                                      <MiniBar value={Number(metrics.views)} max={maxTableViews} color={meta.color || L.accent} height={5} />
                                    </div>
                                  </div>
                                ) : '—'}
                              </td>
                              <td style={{ ...styles.td, ...styles.tdValue, textAlign: 'right' }}>
                                {metrics.engagement_rate != null ? (Number(metrics.engagement_rate) * 100).toFixed(2) + '%' : '—'}
                              </td>
                              <td style={{ ...styles.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700,
                                color: item._vsMedian == null ? L.inkSubtle : item._vsMedian >= 2 ? L.pos : item._vsMedian <= 0.33 ? L.neg : L.inkMuted }}>
                                {item._vsMedian == null ? '—' : `${item._vsMedian.toFixed(1)}×`}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div style={{ marginBottom: '20px' }}><EmptyChart label="No content found for this date range." /></div>
                )}
              </>
            )}
          </div>

          {/* ── Analysis Tools ── */}
          <div style={{ marginTop: '16px' }}>
            <button onClick={() => setShowAnalysis(!showAnalysis)} style={styles.collapseBtn} aria-expanded={showAnalysis}>
              {showAnalysis ? '▾' : '▸'} Analysis Tools
            </button>
            {showAnalysis && (
              <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '0px' }}>
                <FormatPerformance contentItems={analysisData.contentWithMetrics} />
                <PublishHeatmap contentItems={analysisData.contentWithMetrics} />
                <ContentVelocityChart contentItems={analysisData.contentWithMetrics} />
                <FrequencyGrowthChart
                  contentItems={analysisData.contentWithMetrics}
                  audienceSnapshots={analysisData.audienceSnapshots}
                  accounts={accounts}
                />
              </div>
            )}
            </div>
          </section>
        </>
      ))}

      {/* ── F. Data Input Section ── */}
      <div style={{ marginTop: '24px' }}>
        <button onClick={() => setCsvSection(!csvSection)} style={styles.collapseBtn} aria-expanded={csvSection}>
          {csvSection ? '▾' : '▸'} Data Input
        </button>
        {csvSection && <DataInputSection profile={profile} accounts={accounts} />}
      </div>
    </div>
  );
}
