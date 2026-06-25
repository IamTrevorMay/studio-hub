import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import useVisibilityRefresh from '../../hooks/useVisibilityRefresh';
import YouTubeStudioAdvanced from '../YouTubeStudioAdvanced';
import ContentHealthDashboard from '../ContentHealthDashboard';

import { PLATFORM_META, DATE_RANGES, MONTHS, TREND_METRICS } from './constants';
import { daysAgoStr, todayStr, getDateRange, pctChange, formatCompact, fetchAllRows } from './utils';
import { styles } from './styles';

import KPICard from './components/KPICard';
import TrendChart from './components/TrendChart';
import DonutChart from './components/DonutChart';
import PlatformViewSafe from './components/PlatformView';
import IngestionHealthPanel from './components/IngestionHealthPanel';
import DataInputSection from './components/DataInputSection';
import RPMCard from './components/RPMCard';
import PublishHeatmap from './components/PublishHeatmap';
import ContentVelocityChart from './components/ContentVelocityChart';
import FrequencyGrowthChart from './components/FrequencyGrowthChart';
import CompareView from './components/CompareView';
import WeeklyReport from './components/WeeklyReport';
import SyncHealthWidget from './components/SyncHealthWidget';

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
  const [contentRefreshing, setContentRefreshing] = useState(false);
  const platformDropdownRef = useRef(null);
  const platformMenuRef = useRef(null);

  // Data
  const [kpi, setKpi] = useState(null);
  const [timeSeries, setTimeSeries] = useState([]);
  const [contentItems, setContentItems] = useState([]);
  const [loading, setLoading] = useState(true);

  // Content table sort
  const [sortCol, setSortCol] = useState('published_at');
  const [sortDir, setSortDir] = useState('desc');

  // CSV upload (preserved)
  const [csvSection, setCsvSection] = useState(false);

  // Content performance (collapsible)
  const [showContentPerf, setShowContentPerf] = useState(false);

  // Ingestion health (admin)
  const [showIngestion, setShowIngestion] = useState(false);
  const [ingestionLogs, setIngestionLogs] = useState([]);
  const [viewMode, setViewMode] = useState('dashboard');
  const [platformMenuOpen, setPlatformMenuOpen] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState(null);
  const [selectedPlatformAccountId, setSelectedPlatformAccountId] = useState(null);

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
  const kpiGenRef = useRef(0);
  const timeSeriesGenRef = useRef(0);
  const contentGenRef = useRef(0);
  const analysisGenRef = useRef(0);

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
      if (platformMenuRef.current && !platformMenuRef.current.contains(e.target)) {
        setPlatformMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

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

  // ── Fetch all data when filters change ──
  const { start, end } = getDateRange(dateRange, customStart, customEnd, filterMonth, filterYear);

  const fetchAllData = useCallback(async () => {
    const gen = ++allDataGenRef.current;
    setLoading(true);
    try {
      await Promise.all([
        fetchKPI(),
        fetchTimeSeries(),
        fetchContentPerformance(),
        fetchAnalysisData(),
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
        .select('id, title, published_at, platform_account_id, url, platform_account:platform_accounts(platform, account_name), latest_metrics:content_metrics(views, likes, comments, shares, engagement_rate)')
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

  async function fetchKPI() {
    const gen = ++kpiGenRef.current;
    const { start, end } = getDateRange(dateRange, customStart, customEnd, filterMonth, filterYear);

    // Current period
    let q = supabase
      .from('daily_platform_rollups')
      .select('total_views, total_likes, total_comments, total_shares, followers_eod, platform_account_id')
      .gte('date', start)
      .lte('date', end);
    if (activeAccountIds.length > 0) q = q.in('platform_account_id', activeAccountIds);
    const rollups = await fetchAllRows(q);

    // Previous period (min 1 day so a same-day range still has a real prev window
    // instead of an empty query → always +100%/0%).
    const daysDiff = Math.max(1, Math.ceil((new Date(end) - new Date(start)) / 86400000));
    const prevStart = new Date(new Date(start).getTime() - daysDiff * 86400000).toISOString().split('T')[0];
    let pq = supabase
      .from('daily_platform_rollups')
      .select('total_views, total_likes, total_comments, total_shares')
      .gte('date', prevStart)
      .lt('date', start);
    if (activeAccountIds.length > 0) pq = pq.in('platform_account_id', activeAccountIds);
    const prevRollups = await fetchAllRows(pq);

    // Audience — get the latest snapshot for each active account. Apply the same
    // platform filter as the view/engagement queries, else Net/Total Followers
    // ignore the filter and disagree with the other KPI cards.
    let aq = supabase
      .from('audience_snapshots')
      .select('followers_total, followers_gained, platform_account_id')
      .eq('date', end);
    if (activeAccountIds.length > 0) aq = aq.in('platform_account_id', activeAccountIds);
    const { data: latestAudience } = await aq;

    const totalViews = rollups.reduce((s, r) => s + Number(r.total_views), 0);
    const prevViews = prevRollups.reduce((s, r) => s + Number(r.total_views), 0);
    const totalFollowers = (latestAudience || []).reduce((s, a) => s + Number(a.followers_total), 0);
    const followersGained = (latestAudience || []).reduce((s, a) => s + Number(a.followers_gained), 0);

    const totalEngagement = rollups.reduce((s, r) => s + Number(r.total_likes || 0) + Number(r.total_comments || 0) + Number(r.total_shares || 0), 0);
    const prevEngagement = prevRollups.reduce((s, r) => s + Number(r.total_likes || 0) + Number(r.total_comments || 0) + Number(r.total_shares || 0), 0);

    if (gen !== kpiGenRef.current) return;
    setKpi({
      totalViews,
      totalFollowers,
      totalEngagement,
      viewsChange: pctChange(totalViews, prevViews),
      followersChange: followersGained,
      engagementChange: pctChange(totalEngagement, prevEngagement),
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

  // ── Aggregate time series by date (with gap-fill) ──
  const aggregatedTimeSeries = useMemo(() => {
    const byDate = {};
    for (const row of timeSeries) {
      if (!byDate[row.date]) {
        byDate[row.date] = { date: row.date, total_views: 0, revenue_cents: 0, total_likes: 0, total_comments: 0, total_shares: 0, followers_eod: 0 };
      }
      byDate[row.date].total_views += Number(row.total_views) || 0;
      byDate[row.date].revenue_cents += Number(row.revenue_cents) || 0;
      byDate[row.date].total_likes += Number(row.total_likes) || 0;
      byDate[row.date].total_comments += Number(row.total_comments) || 0;
      byDate[row.date].total_shares += Number(row.total_shares) || 0;
      byDate[row.date].followers_eod += Number(row.followers_eod) || 0;
    }
    const sorted = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
    if (sorted.length < 2) return sorted;

    // Fill gaps: generate full date sequence between first and last
    const fields = ['total_views', 'revenue_cents', 'total_likes', 'total_comments', 'total_shares', 'followers_eod'];
    const dateMap = {};
    for (const row of sorted) dateMap[row.date] = row;

    const result = [];
    const start = new Date(sorted[0].date + 'T00:00:00');
    const end = new Date(sorted[sorted.length - 1].date + 'T00:00:00');
    const cur = new Date(start);

    while (cur <= end) {
      const ymd = cur.toISOString().slice(0, 10);
      if (dateMap[ymd]) {
        result.push(dateMap[ymd]);
      } else {
        // Find nearest real data points before and after this gap
        const prevIdx = result.length - 1;
        let afterDate = null;
        const probe = new Date(cur);
        probe.setDate(probe.getDate() + 1);
        while (probe <= end) {
          const pYmd = probe.toISOString().slice(0, 10);
          if (dateMap[pYmd]) { afterDate = pYmd; break; }
          probe.setDate(probe.getDate() + 1);
        }
        // Count consecutive missing days in this gap
        let gapSize = 0;
        const gapProbe = new Date(cur);
        while (gapProbe <= end && !dateMap[gapProbe.toISOString().slice(0, 10)]) {
          gapSize++;
          gapProbe.setDate(gapProbe.getDate() + 1);
        }

        if (gapSize <= 2 && prevIdx >= 0 && afterDate && dateMap[afterDate]) {
          // Linear interpolation for 1–2 day gaps
          const before = result[prevIdx];
          const after = dateMap[afterDate];
          const totalGap = Math.round((new Date(afterDate + 'T00:00:00') - new Date(before.date + 'T00:00:00')) / 86400000);
          const dayOffset = Math.round((cur - new Date(before.date + 'T00:00:00')) / 86400000);
          const ratio = dayOffset / totalGap;
          const interpolated = { date: ymd, _interpolated: true };
          for (const f of fields) {
            interpolated[f] = Math.round((before[f] || 0) + ((after[f] || 0) - (before[f] || 0)) * ratio);
          }
          result.push(interpolated);
        } else {
          // 3+ day gap: insert zero-valued row with gap marker
          const gapRow = { date: ymd, _gap: true };
          for (const f of fields) gapRow[f] = 0;
          result.push(gapRow);
        }
      }
      cur.setDate(cur.getDate() + 1);
    }
    return result;
  }, [timeSeries]);

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

  // ── Sort content items ──
  const sortedContent = useMemo(() => {
    return [...contentItems].sort((a, b) => {
      let va, vb;
      if (sortCol === 'views' || sortCol === 'engagement_rate') {
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
  }, [contentItems, sortCol, sortDir]);

  function handleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('desc'); }
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
            <span style={{ fontSize: '12px', color: syncStatus.includes('failed') || syncStatus.includes('warning') ? '#f59e0b' : '#22c55e', fontWeight: 600 }}>
              {syncStatus}
            </span>
          )}
          <button
            onClick={handleSyncAllPlatforms}
            disabled={syncing}
            style={{
              padding: '8px 16px', borderRadius: '8px', border: '1px solid rgba(99,102,241,0.3)',
              background: syncing ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.15)',
              color: '#a5b4fc', fontSize: '13px', fontWeight: 600, cursor: syncing ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: '6px',
              opacity: syncing ? 0.7 : 1, transition: 'all 0.15s',
            }}
          >
            <span style={{ display: 'inline-block', animation: syncing ? 'spin 1s linear infinite' : 'none' }}>↻</span>
            {syncing ? 'Syncing...' : 'Refresh All'}
          </button>
        </div>
      </div>

      {/* ── A. Date Range & Platform Filters (Dashboard only) ── */}
      {viewMode !== 'advanced' && viewMode !== 'compare' && viewMode !== 'weekly' && <div style={styles.filterBar}>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Month dropdown */}
          <select value={dateRange === 'month' ? filterMonth : ''}
            onChange={e => { setDateRange('month'); setFilterMonth(Number(e.target.value)); }}
            style={{ ...styles.filterSelect, ...(dateRange === 'month' ? styles.filterSelectActive : {}) }}>
            <option value="" disabled>Month</option>
            {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
          </select>

          {/* Year dropdown */}
          <select value={dateRange === 'year' || dateRange === 'month' ? filterYear : ''}
            onChange={e => { if (dateRange !== 'month') setDateRange('year'); setFilterYear(Number(e.target.value)); }}
            style={{ ...styles.filterSelect, ...(dateRange === 'year' || dateRange === 'month' ? styles.filterSelectActive : {}) }}>
            <option value="" disabled>Year</option>
            {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>

          {/* Lifetime */}
          <button onClick={() => setDateRange('lifetime')}
            style={{ ...styles.filterChip, ...(dateRange === 'lifetime' ? styles.filterChipActive : {}) }}>
            Lifetime
          </button>

          {/* Quick presets */}
          {DATE_RANGES.filter(r => r.key !== 'custom').map(r => (
            <button key={r.key} onClick={() => setDateRange(r.key)}
              style={{ ...styles.filterChip, ...(dateRange === r.key ? styles.filterChipActive : {}) }}>
              {r.label}
            </button>
          ))}

          {/* Custom */}
          <button onClick={() => setDateRange('custom')}
            style={{ ...styles.filterChip, ...(dateRange === 'custom' ? styles.filterChipActive : {}) }}>
            Custom
          </button>
          {dateRange === 'custom' && (
            <>
              <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} style={styles.filterInput} />
              <span style={{ color: 'rgba(255,255,255,0.3)' }}>to</span>
              <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} style={styles.filterInput} />
            </>
          )}
        </div>

        {/* Platform dropdown */}
        <div ref={platformDropdownRef} style={{ position: 'relative' }}>
          <button onClick={() => setPlatformDropdownOpen(!platformDropdownOpen)}
            style={{ ...styles.filterChip, display: 'flex', alignItems: 'center', gap: '6px' }}>
            Platforms
            {activeAccountIds.length > 0 && (
              <span style={{ background: 'rgba(99,102,241,0.3)', padding: '1px 6px', borderRadius: '8px', fontSize: '10px', fontWeight: 700, color: '#a5b4fc' }}>
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
      </div>}

      {/* ── View Mode Toggle ── */}
      <div style={styles.viewToggleBar}>
        <button onClick={() => setViewMode('dashboard')} style={viewMode === 'dashboard' ? styles.viewToggleBtnActive : styles.viewToggleBtn}>Dashboard</button>
        <button onClick={() => setViewMode('compare')} style={viewMode === 'compare' ? styles.viewToggleBtnActive : styles.viewToggleBtn}>Compare</button>
        <button onClick={() => setViewMode('weekly')} style={viewMode === 'weekly' ? styles.viewToggleBtnActive : styles.viewToggleBtn}>Weekly Report</button>
        <button onClick={() => setViewMode('advanced')} style={viewMode === 'advanced' ? styles.viewToggleBtnActive : styles.viewToggleBtn}>Advanced</button>
        <button onClick={() => setViewMode('health')} style={viewMode === 'health' ? styles.viewToggleBtnActive : styles.viewToggleBtn}>Content Health</button>
        <div ref={platformMenuRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setPlatformMenuOpen(prev => !prev)}
            style={viewMode === 'platform' ? styles.viewToggleBtnActive : styles.viewToggleBtn}
          >
            Platforms {selectedPlatform && viewMode === 'platform' ? `· ${PLATFORM_META[selectedPlatform]?.label || selectedPlatform}` : ''} ▾
          </button>
          {platformMenuOpen && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 100,
              background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10,
              boxShadow: '0 8px 32px rgba(0,0,0,0.4)', overflow: 'hidden', minWidth: 160,
            }}>
              {accounts.filter(a => a.is_active).map(a => {
                const meta = PLATFORM_META[a.platform] || {};
                return (
                  <button key={a.id} onClick={() => { setSelectedPlatform(a.platform); setSelectedPlatformAccountId(a.id); setViewMode('platform'); setPlatformMenuOpen(false); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 16px',
                      background: selectedPlatformAccountId === a.id && viewMode === 'platform' ? 'rgba(99,102,241,0.15)' : 'transparent',
                      border: 'none', color: 'rgba(255,255,255,0.8)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                    }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: meta.color || '#666', flexShrink: 0 }} />
                    {a.account_name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
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

      {viewMode === 'platform' && selectedPlatformAccountId && (
        <PlatformViewSafe accountId={selectedPlatformAccountId} accounts={accounts} start={start} end={end} />
      )}

      {viewMode === 'dashboard' && (loading ? <p style={styles.loadingText}>Loading analytics...</p> : (
        <>
          {/* ── Dashboard Sections ── */}
          {/* ── Sync Health (admin-only) ── */}
          {isAdmin && <SyncHealthWidget />}

          {/* ── B. KPI Summary Cards ── */}
          {kpi && (
            <div style={styles.kpiGrid}>
              <KPICard label="Total Views" value={Number(kpi.totalViews).toLocaleString()} change={kpi.viewsChange} color="#6366f1" />
              <KPICard label="Total Engagement" value={formatCompact(kpi.totalEngagement)} change={kpi.engagementChange} color="#22c55e" />
              <KPICard label="Net Followers" value={Number(kpi.totalFollowers).toLocaleString()}
                change={kpi.followersChange} changeLabel={`${kpi.followersChange >= 0 ? '+' : ''}${Number(kpi.followersChange).toLocaleString()} this period`} color="#ec4899" />
            </div>
          )}

          {/* ── C. Trend Chart ── */}
          <div style={{ ...styles.chartSection, width: '100%' }}>
            <div style={styles.chartHeader}>
              <span style={styles.chartTitle}>Trends</span>
              <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
                {TREND_METRICS.map(m => (
                  <div key={m.key} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: m.color, flexShrink: 0 }} />
                    <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', fontWeight: 500 }}>{m.label}</span>
                  </div>
                ))}
              </div>
            </div>
            {aggregatedTimeSeries.length > 0 ? (
              <TrendChart data={aggregatedTimeSeries} metrics={TREND_METRICS} />
            ) : (
              <p style={styles.emptyText}>No data for selected period</p>
            )}
          </div>

          {/* ── D. Platform Breakdowns (Donuts) ── */}
          {platformBreakdown.length > 0 && (
            <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
              {/* Views */}
              {platformBreakdown.some(p => p.views > 0) && (
                <div style={{ ...styles.chartSection, flex: '1 1 340px', minWidth: '300px', borderLeft: '3px solid #6366f1' }}>
                  <span style={{ ...styles.chartTitle, color: '#6366f1' }}>Views by Platform</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '24px', marginTop: '16px', flexWrap: 'wrap' }}>
                    <DonutChart data={platformBreakdown} valueKey="views" centerLabel="total views" />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {platformBreakdown.filter(p => p.views > 0).map(p => {
                        const total = platformBreakdown.reduce((s, x) => s + x.views, 0);
                        return (
                          <div key={p.label} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ width: '10px', height: '10px', borderRadius: '3px', background: p.color, flexShrink: 0 }} />
                            <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)', minWidth: '70px' }}>{p.label}</span>
                            <span style={{ fontSize: '12px', fontWeight: 600, color: '#fff' }}>{formatCompact(p.views)}</span>
                            <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)' }}>({(total > 0 ? (p.views / total) * 100 : 0).toFixed(1)}%)</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
              {/* Engagement */}
              {platformBreakdown.some(p => p.engagement > 0) && (
                <div style={{ ...styles.chartSection, flex: '1 1 340px', minWidth: '300px', borderLeft: '3px solid #22c55e' }}>
                  <span style={{ ...styles.chartTitle, color: '#22c55e' }}>Engagement by Platform</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '24px', marginTop: '16px', flexWrap: 'wrap' }}>
                    <DonutChart data={platformBreakdown.filter(p => p.engagement > 0)} valueKey="engagement" centerLabel="avg engagement"
                      formatValue={v => {
                        const avg = platformBreakdown.filter(p => p.engagement > 0).length;
                        return avg > 0 ? ((v / avg) * 100).toFixed(2) + '%' : '0%';
                      }} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {platformBreakdown.filter(p => p.engagement > 0).map(p => (
                        <div key={p.label} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ width: '10px', height: '10px', borderRadius: '3px', background: p.color, flexShrink: 0 }} />
                          <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)', minWidth: '70px' }}>{p.label}</span>
                          <span style={{ fontSize: '12px', fontWeight: 600, color: '#fff' }}>{(p.engagement * 100).toFixed(2)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {/* Followers */}
              {platformBreakdown.some(p => p.followers > 0) && (
                <div style={{ ...styles.chartSection, flex: '1 1 340px', minWidth: '300px', borderLeft: '3px solid #ec4899' }}>
                  <span style={{ ...styles.chartTitle, color: '#ec4899' }}>Followers by Platform</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '24px', marginTop: '16px', flexWrap: 'wrap' }}>
                    <DonutChart data={platformBreakdown.filter(p => p.followers > 0)} valueKey="followers" centerLabel="total followers" />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {platformBreakdown.filter(p => p.followers > 0).map(p => {
                        const total = platformBreakdown.filter(x => x.followers > 0).reduce((s, x) => s + x.followers, 0);
                        return (
                          <div key={p.label} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ width: '10px', height: '10px', borderRadius: '3px', background: p.color, flexShrink: 0 }} />
                            <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)', minWidth: '70px' }}>{p.label}</span>
                            <span style={{ fontSize: '12px', fontWeight: 600, color: '#fff' }}>{formatCompact(p.followers)}</span>
                            <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)' }}>({(total > 0 ? (p.followers / total) * 100 : 0).toFixed(1)}%)</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── E. Content Performance Table ── */}
          <div style={{ marginTop: '16px' }}>
            <button onClick={() => setShowContentPerf(!showContentPerf)} style={styles.collapseBtn}>
              {showContentPerf ? '▾' : '▸'} Content Performance ({contentItems.length})
            </button>
            {showContentPerf && (
              <>
                <div style={{ ...styles.tableHeader, marginTop: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <button onClick={handleContentRefresh} disabled={contentRefreshing}
                      style={{
                        background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer',
                        fontSize: '16px', padding: '2px 6px', fontFamily: 'inherit', lineHeight: 1,
                        animation: contentRefreshing ? 'spin 0.8s linear infinite' : 'none',
                      }}
                      title="Refresh content performance">
                      ↻
                    </button>
                    <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
                  </div>
                </div>
                {sortedContent.length > 0 ? (
                  <div style={styles.tableWrap}>
                    <table style={styles.table}>
                      <thead>
                        <tr>
                          <th style={{ ...styles.th, ...styles.thSticky, cursor: 'pointer' }} onClick={() => handleSort('title')}>
                            Title {sortCol === 'title' && <span style={styles.sortArrow}>{sortDir === 'asc' ? '↑' : '↓'}</span>}
                          </th>
                          <th style={{ ...styles.th, cursor: 'pointer' }} onClick={() => handleSort('platform')}>
                            Platform {sortCol === 'platform' && <span style={styles.sortArrow}>{sortDir === 'asc' ? '↑' : '↓'}</span>}
                          </th>
                          <th style={{ ...styles.th, cursor: 'pointer' }} onClick={() => handleSort('published_at')}>
                            Date {sortCol === 'published_at' && <span style={styles.sortArrow}>{sortDir === 'asc' ? '↑' : '↓'}</span>}
                          </th>
                          <th style={{ ...styles.th, textAlign: 'right', cursor: 'pointer' }} onClick={() => handleSort('views')}>
                            Views {sortCol === 'views' && <span style={styles.sortArrow}>{sortDir === 'asc' ? '↑' : '↓'}</span>}
                          </th>
                          <th style={{ ...styles.th, textAlign: 'right', cursor: 'pointer' }} onClick={() => handleSort('engagement_rate')}>
                            Engagement {sortCol === 'engagement_rate' && <span style={styles.sortArrow}>{sortDir === 'asc' ? '↑' : '↓'}</span>}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedContent.map((item, i) => {
                          const metrics = item.latest_metrics?.[0] || {};
                          const platform = item.platform_account?.platform;
                          const meta = PLATFORM_META[platform] || {};
                          return (
                            <tr key={item.id} style={i % 2 === 0 ? styles.trEven : {}}>
                              <td style={{ ...styles.td, ...styles.tdSticky, background: i % 2 === 0 ? 'rgba(255,255,255,0.01)' : '#12121f' }}>
                                {item.url ? (
                                  <a href={item.url} target="_blank" rel="noopener noreferrer"
                                    style={{ color: '#e2e8f0', textDecoration: 'none', fontWeight: 500 }}>
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
                              <td style={{ ...styles.td, ...styles.tdValue, textAlign: 'right' }}>
                                {metrics.views != null ? formatCompact(Number(metrics.views)) : '—'}
                              </td>
                              <td style={{ ...styles.td, ...styles.tdValue, textAlign: 'right' }}>
                                {metrics.engagement_rate != null ? (Number(metrics.engagement_rate) * 100).toFixed(2) + '%' : '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div style={styles.emptyCard}>
                    <p style={styles.emptyText}>No content found for this date range.</p>
                  </div>
                )}
              </>
            )}
          </div>

          {/* ── Analysis Tools ── */}
          <div style={{ marginTop: '16px' }}>
            <button onClick={() => setShowAnalysis(!showAnalysis)} style={styles.collapseBtn}>
              {showAnalysis ? '▾' : '▸'} Analysis Tools
            </button>
            {showAnalysis && (
              <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '0px' }}>
                <RPMCard revenueData={analysisData.revenue} timeSeries={timeSeries} accounts={accounts} />
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
        </>
      ))}

      {/* ── F. Data Input Section ── */}
      <div style={{ marginTop: '24px' }}>
        <button onClick={() => setCsvSection(!csvSection)} style={styles.collapseBtn}>
          {csvSection ? '▾' : '▸'} Data Input
        </button>
        {csvSection && <DataInputSection profile={profile} accounts={accounts} />}
      </div>

      {/* ── G. Ingestion Health Panel (admin only) ── */}
      {isAdmin && (
        <div style={{ marginTop: '16px' }}>
          <button onClick={() => {
            setShowIngestion(!showIngestion);
            if (!showIngestion) fetchIngestionLogs();
          }} style={styles.collapseBtn}>
            {showIngestion ? '▾' : '▸'} Ingestion Health (Admin)
          </button>
          {showIngestion && <IngestionHealthPanel logs={ingestionLogs} accounts={accounts} onRefresh={fetchIngestionLogs} />}
        </div>
      )}
    </div>
  );

  async function fetchIngestionLogs() {
    const { data } = await supabase
      .from('ingestion_logs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(50);
    if (data) setIngestionLogs(data);
  }
}
