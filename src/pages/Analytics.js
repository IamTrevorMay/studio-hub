import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';

// ═══════════════════════════════════════════════
// Platform Config
// ═══════════════════════════════════════════════
const PLATFORM_META = {
  youtube:   { label: 'YouTube',   color: '#FF0000', icon: 'YT' },
  facebook:  { label: 'Facebook',  color: '#1877F2', icon: 'FB' },
  instagram: { label: 'Instagram', color: '#E4405F', icon: 'IG' },
  tiktok:    { label: 'TikTok',    color: '#00F2EA', icon: 'TT' },
  substack:  { label: 'Substack',  color: '#FF6719', icon: 'SS' },
  twitch:    { label: 'Twitch',    color: '#9146FF', icon: 'TW' },
  stripe:    { label: 'Stripe',    color: '#635BFF', icon: '$' },
};

const DATE_RANGES = [
  { key: '7d',  label: '7 days',  days: 7 },
  { key: '30d', label: '30 days', days: 30 },
  { key: '90d', label: '90 days', days: 90 },
  { key: '1y',  label: '1 year',  days: 365 },
  { key: 'custom', label: 'Custom' },
];

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function getMonthRange(year, month) {
  const start = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const end = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}

function getYearRange(year) {
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

const TREND_METRICS = [
  { key: 'views',      label: 'Views' },
  { key: 'revenue',    label: 'Revenue' },
  { key: 'engagement', label: 'Engagement' },
  { key: 'followers',  label: 'Followers' },
];

const LINE_COLORS = ['#6366f1', '#f59e0b', '#22c55e', '#ec4899', '#3b82f6', '#a855f7', '#14b8a6'];

// ═══════════════════════════════════════════════
// Date helpers
// ═══════════════════════════════════════════════
function todayStr() { return new Date().toISOString().split('T')[0]; }
function daysAgoStr(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().split('T')[0]; }

function getDateRange(rangeKey, customStart, customEnd, filterMonth, filterYear) {
  if (rangeKey === 'month') return getMonthRange(filterYear, filterMonth);
  if (rangeKey === 'year') return getYearRange(filterYear);
  if (rangeKey === 'lifetime') return { start: '2000-01-01', end: todayStr() };
  if (rangeKey === 'custom' && customStart && customEnd) {
    return { start: customStart, end: customEnd };
  }
  const preset = DATE_RANGES.find(r => r.key === rangeKey);
  const days = preset?.days || 30;
  return { start: daysAgoStr(days), end: todayStr() };
}

function getPreviousPeriod(start, end) {
  const daysDiff = Math.ceil((new Date(end) - new Date(start)) / 86400000);
  const prevStart = daysAgoStr(daysDiff + Math.ceil((new Date() - new Date(start)) / 86400000));
  const prevEnd = new Date(new Date(start).getTime() - 86400000).toISOString().split('T')[0];
  return { start: prevStart, end: prevEnd };
}

function pctChange(curr, prev) {
  if (prev === 0) return curr > 0 ? 100 : 0;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

function formatCompact(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  if (n % 1 !== 0) return n.toFixed(1);
  return n.toLocaleString();
}

function formatCurrency(cents) {
  return '$' + (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ═══════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════
export default function Analytics() {
  const { profile, isAdmin } = useAuth();

  // Filters
  const [dateRange, setDateRange] = useState('30d');
  const [customStart, setCustomStart] = useState(daysAgoStr(30));
  const [customEnd, setCustomEnd] = useState(todayStr());
  const [filterMonth, setFilterMonth] = useState(new Date().getMonth());
  const [filterYear, setFilterYear] = useState(new Date().getFullYear());
  const [activeAccountIds, setActiveAccountIds] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [trendMetric, setTrendMetric] = useState('views');
  const [platformDropdownOpen, setPlatformDropdownOpen] = useState(false);
  const platformDropdownRef = useRef(null);

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
  const [csvPlatform, setCsvPlatform] = useState('youtube_trevormay');

  // Ingestion health (admin)
  const [showIngestion, setShowIngestion] = useState(false);
  const [ingestionLogs, setIngestionLogs] = useState([]);

  // Close platform dropdown on outside click
  useEffect(() => {
    function handleClick(e) {
      if (platformDropdownRef.current && !platformDropdownRef.current.contains(e.target)) {
        setPlatformDropdownOpen(false);
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

  useEffect(() => {
    fetchAllData();
  }, [dateRange, customStart, customEnd, filterMonth, filterYear, activeAccountIds.join(',')]);

  async function fetchAllData() {
    setLoading(true);
    await Promise.all([
      fetchKPI(),
      fetchTimeSeries(),
      fetchContentPerformance(),
    ]);
    setLoading(false);
  }

  async function fetchKPI() {
    const { start, end } = getDateRange(dateRange, customStart, customEnd, filterMonth, filterYear);

    // Current period
    let q = supabase
      .from('daily_platform_rollups')
      .select('*')
      .gte('date', start)
      .lte('date', end);
    if (activeAccountIds.length > 0) q = q.in('platform_account_id', activeAccountIds);
    const { data: rollups } = await q;

    // Previous period
    const daysDiff = Math.ceil((new Date(end) - new Date(start)) / 86400000);
    const prevStart = new Date(new Date(start).getTime() - daysDiff * 86400000).toISOString().split('T')[0];
    let pq = supabase
      .from('daily_platform_rollups')
      .select('*')
      .gte('date', prevStart)
      .lt('date', start);
    if (activeAccountIds.length > 0) pq = pq.in('platform_account_id', activeAccountIds);
    const { data: prevRollups } = await pq;

    // Revenue
    let rq = supabase
      .from('revenue_events')
      .select('net_amount_cents, event_type')
      .gte('occurred_at', start)
      .lte('occurred_at', end)
      .in('event_type', ['charge', 'subscription_renewal']);
    if (activeAccountIds.length > 0) rq = rq.in('platform_account_id', activeAccountIds);
    const { data: revenue } = await rq;

    let prq = supabase
      .from('revenue_events')
      .select('net_amount_cents')
      .gte('occurred_at', prevStart)
      .lt('occurred_at', start)
      .in('event_type', ['charge', 'subscription_renewal']);
    if (activeAccountIds.length > 0) prq = prq.in('platform_account_id', activeAccountIds);
    const { data: prevRevenue } = await prq;

    // Audience
    const { data: latestAudience } = await supabase
      .from('audience_snapshots')
      .select('followers_total, followers_gained, platform_account_id')
      .eq('date', end);

    const totalViews = (rollups || []).reduce((s, r) => s + Number(r.total_views), 0);
    const prevViews = (prevRollups || []).reduce((s, r) => s + Number(r.total_views), 0);
    const totalRev = (revenue || []).reduce((s, r) => s + r.net_amount_cents, 0);
    const prevRev = (prevRevenue || []).reduce((s, r) => s + r.net_amount_cents, 0);
    const totalFollowers = (latestAudience || []).reduce((s, a) => s + Number(a.followers_total), 0);
    const followersGained = (latestAudience || []).reduce((s, a) => s + Number(a.followers_gained), 0);

    const avgEng = rollups && rollups.length > 0
      ? rollups.reduce((s, r) => s + Number(r.avg_engagement_rate), 0) / rollups.length
      : 0;
    const prevAvgEng = prevRollups && prevRollups.length > 0
      ? prevRollups.reduce((s, r) => s + Number(r.avg_engagement_rate), 0) / prevRollups.length
      : 0;

    setKpi({
      totalViews,
      totalRevenue: totalRev,
      totalFollowers,
      avgEngagement: avgEng,
      viewsChange: pctChange(totalViews, prevViews),
      revenueChange: pctChange(totalRev, prevRev),
      followersChange: followersGained,
      engagementChange: pctChange(avgEng, prevAvgEng),
    });
  }

  async function fetchTimeSeries() {
    const { start, end } = getDateRange(dateRange, customStart, customEnd, filterMonth, filterYear);
    let q = supabase
      .from('daily_platform_rollups')
      .select('*')
      .gte('date', start)
      .lte('date', end)
      .order('date', { ascending: true });
    if (activeAccountIds.length > 0) q = q.in('platform_account_id', activeAccountIds);
    const { data } = await q;
    setTimeSeries(data || []);
  }

  async function fetchContentPerformance() {
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
    setContentItems(data || []);
  }

  // ── Toggle account filter ──
  function toggleAccount(accountId) {
    setActiveAccountIds(prev => {
      if (prev.includes(accountId)) return prev.filter(id => id !== accountId);
      return [...prev, accountId];
    });
  }

  // ── Aggregate time series by date ──
  const aggregatedTimeSeries = useMemo(() => {
    const byDate = {};
    for (const row of timeSeries) {
      if (!byDate[row.date]) {
        byDate[row.date] = { date: row.date, total_views: 0, revenue_cents: 0, avg_engagement_rate: 0, followers_eod: 0, _count: 0 };
      }
      byDate[row.date].total_views += Number(row.total_views) || 0;
      byDate[row.date].revenue_cents += Number(row.revenue_cents) || 0;
      byDate[row.date].avg_engagement_rate += Number(row.avg_engagement_rate) || 0;
      byDate[row.date].followers_eod += Number(row.followers_eod) || 0;
      byDate[row.date]._count += 1;
    }
    return Object.values(byDate)
      .map(d => ({
        ...d,
        avg_engagement_rate: d._count > 0 ? d.avg_engagement_rate / d._count : 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [timeSeries]);

  // ── Account breakdown for donut ──
  const platformBreakdown = useMemo(() => {
    const byAccount = {};
    for (const row of timeSeries) {
      const key = row.platform_account_id;
      if (!byAccount[key]) byAccount[key] = { views: 0, platform: row.platform, name: row.account_name };
      byAccount[key].views += Number(row.total_views) || 0;
    }
    const total = Object.values(byAccount).reduce((s, v) => s + v.views, 0);
    return Object.entries(byAccount)
      .map(([id, info]) => ({
        platform: info.platform,
        views: info.views,
        pct: total > 0 ? (info.views / total) * 100 : 0,
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

  // ── Get trend metric value from a row ──
  function getTrendValue(row) {
    switch (trendMetric) {
      case 'views': return row.total_views;
      case 'revenue': return row.revenue_cents / 100;
      case 'engagement': return row.avg_engagement_rate * 100;
      case 'followers': return row.followers_eod;
      default: return 0;
    }
  }

  return (
    <div style={styles.page}>
      {/* ── Top Bar ── */}
      <div style={styles.topBar}>
        <div>
          <h1 style={styles.pageTitle}>Analytics Command Center</h1>
          <p style={styles.pageSubtitle}>Multi-platform performance dashboard</p>
        </div>
      </div>

      {/* ── A. Date Range & Platform Filters ── */}
      <div style={styles.filterBar}>
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
      </div>

      {loading ? <p style={styles.loadingText}>Loading analytics...</p> : (
        <>
          {/* ── B. KPI Summary Cards ── */}
          {kpi && (
            <div style={styles.kpiGrid}>
              <KPICard label="Total Views" value={formatCompact(kpi.totalViews)} change={kpi.viewsChange} color="#6366f1" />
              <KPICard label="Total Revenue" value={formatCurrency(kpi.totalRevenue)} change={kpi.revenueChange} color="#22c55e" />
              <KPICard label="Net Followers" value={formatCompact(kpi.totalFollowers)}
                change={kpi.followersChange} changeLabel={`${kpi.followersChange >= 0 ? '+' : ''}${formatCompact(kpi.followersChange)} this period`} color="#3b82f6" />
              <KPICard label="Avg Engagement" value={(kpi.avgEngagement * 100).toFixed(2) + '%'} change={kpi.engagementChange} color="#f59e0b" />
            </div>
          )}

          {/* ── C. Trend Chart ── */}
          <div style={styles.chartSection}>
            <div style={styles.chartHeader}>
              <span style={styles.chartTitle}>Trends</span>
              <div style={{ display: 'flex', gap: '4px' }}>
                {TREND_METRICS.map(m => (
                  <button key={m.key} onClick={() => setTrendMetric(m.key)}
                    style={{ ...styles.metricChip, ...(trendMetric === m.key ? styles.metricChipActive : {}) }}>
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            {aggregatedTimeSeries.length > 0 ? (
              <TrendChart data={aggregatedTimeSeries} getValue={getTrendValue} color="#6366f1" />
            ) : (
              <p style={styles.emptyText}>No data for selected period</p>
            )}
          </div>

          {/* ── D. Platform Breakdown (Donut) ── */}
          {platformBreakdown.length > 0 && platformBreakdown.some(p => p.views > 0) && (
            <div style={styles.chartSection}>
              <span style={styles.chartTitle}>Views by Platform</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '40px', marginTop: '16px', flexWrap: 'wrap' }}>
                <DonutChart data={platformBreakdown} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {platformBreakdown.map(p => (
                    <div key={p.platform} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ width: '12px', height: '12px', borderRadius: '3px', background: p.color, flexShrink: 0 }} />
                      <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.7)', minWidth: '80px' }}>{p.label}</span>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: '#fff' }}>{formatCompact(p.views)}</span>
                      <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)' }}>({p.pct.toFixed(1)}%)</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── E. Content Performance Table ── */}
          <div style={styles.tableHeader}>
            <span style={styles.tableTitle}>Content Performance ({contentItems.length})</span>
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
                            {meta.label || platform}
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
              {showIngestion && <IngestionHealthPanel logs={ingestionLogs} accounts={accounts} />}
            </div>
          )}
        </>
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

// ═══════════════════════════════════════════════
// KPI Card
// ═══════════════════════════════════════════════
function KPICard({ label, value, change, changeLabel, color }) {
  const isPositive = change >= 0;
  return (
    <div style={styles.kpiCard}>
      <div style={{ ...styles.kpiAccent, background: color }} />
      <div style={styles.kpiLabel}>{label}</div>
      <div style={styles.kpiValue}>{value}</div>
      <div style={{ fontSize: '12px', fontWeight: 500, color: isPositive ? '#4ade80' : '#f87171', marginTop: '4px' }}>
        {changeLabel || `${isPositive ? '+' : ''}${change.toFixed(1)}%`}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// Trend Chart (SVG line graph)
// ═══════════════════════════════════════════════
function TrendChart({ data, getValue, color }) {
  const W = 900, H = 260, PAD = { top: 20, right: 20, bottom: 40, left: 65 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  if (!data.length) return null;

  const values = data.map(d => getValue(d) || 0);
  const maxVal = Math.max(...values, 1);
  const xStep = plotW / Math.max(data.length - 1, 1);
  const yScale = plotH / maxVal;

  const path = data.map((d, i) => {
    const x = PAD.left + i * xStep;
    const y = PAD.top + plotH - ((getValue(d) || 0) * yScale);
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  // Area fill
  const areaPath = path + ` L${(PAD.left + (data.length - 1) * xStep).toFixed(1)},${PAD.top + plotH} L${PAD.left},${PAD.top + plotH} Z`;

  const yTicks = 5;
  const yLabels = Array.from({ length: yTicks + 1 }, (_, i) => {
    const val = (maxVal / yTicks) * i;
    return { val, y: PAD.top + plotH - (val * yScale) };
  });

  const tickCount = Math.min(data.length, 10);
  const tickInterval = Math.max(1, Math.floor(data.length / tickCount));

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxHeight: '280px' }}>
        {yLabels.map((yl, i) => (
          <g key={i}>
            <line x1={PAD.left} y1={yl.y} x2={W - PAD.right} y2={yl.y} stroke="rgba(255,255,255,0.05)" />
            <text x={PAD.left - 8} y={yl.y + 4} fill="rgba(255,255,255,0.3)" fontSize="10" textAnchor="end">
              {formatCompact(yl.val)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          if (i % tickInterval !== 0 && i !== data.length - 1) return null;
          const x = PAD.left + i * xStep;
          return (
            <text key={i} x={x} y={H - 8} fill="rgba(255,255,255,0.3)" fontSize="10" textAnchor="middle">
              {new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </text>
          );
        })}
        <path d={areaPath} fill={color + '15'} />
        <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

// ═══════════════════════════════════════════════
// Donut Chart (SVG)
// ═══════════════════════════════════════════════
function DonutChart({ data }) {
  const size = 160;
  const cx = size / 2, cy = size / 2;
  const outerR = 70, innerR = 45;
  const total = data.reduce((s, d) => s + d.views, 0);
  if (total === 0) return null;

  let cumAngle = -Math.PI / 2;
  const segments = data.map(d => {
    const angle = (d.views / total) * 2 * Math.PI;
    const startAngle = cumAngle;
    cumAngle += angle;
    const endAngle = cumAngle;

    const x1 = cx + outerR * Math.cos(startAngle);
    const y1 = cy + outerR * Math.sin(startAngle);
    const x2 = cx + outerR * Math.cos(endAngle);
    const y2 = cy + outerR * Math.sin(endAngle);
    const x3 = cx + innerR * Math.cos(endAngle);
    const y3 = cy + innerR * Math.sin(endAngle);
    const x4 = cx + innerR * Math.cos(startAngle);
    const y4 = cy + innerR * Math.sin(startAngle);
    const largeArc = angle > Math.PI ? 1 : 0;

    const path = `M${x1},${y1} A${outerR},${outerR} 0 ${largeArc},1 ${x2},${y2} L${x3},${y3} A${innerR},${innerR} 0 ${largeArc},0 ${x4},${y4} Z`;
    return { ...d, path };
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {segments.map((s, i) => (
        <path key={i} d={s.path} fill={s.color} stroke="#12121f" strokeWidth="1" />
      ))}
      <text x={cx} y={cy - 6} textAnchor="middle" fill="#fff" fontSize="16" fontWeight="700">{formatCompact(total)}</text>
      <text x={cx} y={cy + 12} textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="10">total views</text>
    </svg>
  );
}

// ═══════════════════════════════════════════════
// Ingestion Health Panel (Admin)
// ═══════════════════════════════════════════════
function IngestionHealthPanel({ logs, accounts }) {
  const accountMap = {};
  accounts.forEach(a => { accountMap[a.id] = a; });

  const statusColors = {
    running: '#f59e0b',
    success: '#4ade80',
    failed: '#f87171',
    partial: '#fb923c',
  };

  return (
    <div style={{ ...styles.tableWrap, marginTop: '8px', maxHeight: '400px' }}>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Status</th>
            <th style={styles.th}>Platform</th>
            <th style={styles.th}>Job Type</th>
            <th style={{ ...styles.th, textAlign: 'right' }}>Processed</th>
            <th style={styles.th}>Started</th>
            <th style={styles.th}>Duration</th>
            <th style={styles.th}>Error</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log, i) => {
            const acct = accountMap[log.platform_account_id];
            const duration = log.completed_at && log.started_at
              ? Math.round((new Date(log.completed_at) - new Date(log.started_at)) / 1000) + 's'
              : '...';
            return (
              <tr key={log.id} style={i % 2 === 0 ? styles.trEven : {}}>
                <td style={styles.td}>
                  <span style={{
                    display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%',
                    background: statusColors[log.status] || '#666', marginRight: '6px',
                  }} />
                  {log.status}
                </td>
                <td style={styles.td}>{acct?.account_name || '—'}</td>
                <td style={styles.td}>{log.job_type}</td>
                <td style={{ ...styles.td, textAlign: 'right' }}>{log.records_processed || 0}</td>
                <td style={styles.td}>
                  {log.started_at ? new Date(log.started_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                </td>
                <td style={styles.td}>{duration}</td>
                <td style={{ ...styles.td, color: '#f87171', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {log.error_message || '—'}
                </td>
              </tr>
            );
          })}
          {logs.length === 0 && (
            <tr><td colSpan={7} style={{ ...styles.td, textAlign: 'center', color: 'rgba(255,255,255,0.3)' }}>No ingestion logs yet</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ═══════════════════════════════════════════════
// Data Input Section (tabbed: YouTube, TikTok, Instagram, Facebook, Substack, Twitch)
// ═══════════════════════════════════════════════
const DATA_INPUT_TABS = [
  { key: 'youtube',   label: 'YouTube' },
  { key: 'tiktok',    label: 'TikTok' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'facebook',  label: 'Facebook' },
  { key: 'substack',  label: 'Substack' },
  { key: 'twitch',    label: 'Twitch' },
];

function DataInputSection({ profile, accounts }) {
  const [activeTab, setActiveTab] = useState('youtube');
  const meta = PLATFORM_META[activeTab] || {};

  return (
    <div style={{ padding: '16px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', marginTop: '8px' }}>
      <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {DATA_INPUT_TABS.map(t => {
          const pm = PLATFORM_META[t.key] || {};
          const isActive = activeTab === t.key;
          return (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              style={{
                ...styles.filterChip,
                ...(isActive ? { background: (pm.color || '#666') + '22', borderColor: (pm.color || '#666') + '66', color: pm.color || '#666' } : {}),
              }}>
              {t.label}
            </button>
          );
        })}
      </div>
      {activeTab === 'youtube' && <YouTubeCSVUpload profile={profile} />}
      {activeTab === 'tiktok' && <TikTokCSVUpload profile={profile} accounts={accounts} />}
      {activeTab === 'instagram' && <ManualMetricsForm platform="instagram" fields={['views']} accounts={accounts} />}
      {activeTab === 'facebook' && <ManualMetricsForm platform="facebook" fields={['views', 'revenue']} accounts={accounts} />}
      {activeTab === 'substack' && <ManualMetricsForm platform="substack" fields={['views', 'revenue', 'subscribers']} accounts={accounts} />}
      {activeTab === 'twitch' && <ManualMetricsForm platform="twitch" fields={['revenue']} accounts={accounts} />}
    </div>
  );
}

// ═══════════════════════════════════════════════
// TikTok CSV Upload
// ═══════════════════════════════════════════════
function TikTokCSVUpload({ profile, accounts }) {
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const fileInputRef = useRef(null);

  const tiktokAccount = accounts.find(a => a.platform === 'tiktok');
  const color = PLATFORM_META.tiktok?.color || '#00F2EA';

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file || !tiktokAccount) return;
    setUploading(true); setUploadResult(null);

    // Create ingestion log entry
    const { data: logEntry } = await supabase.from('ingestion_logs')
      .insert({ platform_account_id: tiktokAccount.id, job_type: 'manual_csv_upload_tiktok', status: 'running' })
      .select().single();

    try {
      const text = await file.text();
      const parsed = parseCSV(text);
      if (!parsed.rows.length) throw new Error('No valid rows found');

      const rows = [];
      for (const row of parsed.rows) {
        const date = parseDate(row['Date'] || row['date'] || row['DATE']);
        if (!date) continue;
        const views = parseNumber(row['Video Views'] || row['Views'] || row['Video views'] || row['views'] || '0');
        const likes = parseNumber(row['Likes'] || row['likes'] || '0');
        const comments = parseNumber(row['Comments'] || row['comments'] || '0');
        const shares = parseNumber(row['Shares'] || row['shares'] || '0');

        rows.push({
          platform_account_id: tiktokAccount.id,
          date,
          views: views || 0,
          likes: likes || 0,
          comments: comments || 0,
          shares: shares || 0,
          metadata: {},
        });
      }
      if (!rows.length) throw new Error('No valid rows found after parsing');

      let inserted = 0;
      for (let i = 0; i < rows.length; i += 100) {
        const batch = rows.slice(i, i + 100);
        const { data: result, error } = await supabase.from('platform_daily_metrics')
          .upsert(batch, { onConflict: 'platform_account_id,date' }).select();
        if (error) { console.error(error); continue; }
        inserted += result?.length || 0;
      }
      setUploadResult({ success: true, count: inserted });

      if (logEntry?.id) await supabase.from('ingestion_logs').update({
        status: 'success', records_processed: rows.length, records_created: inserted, completed_at: new Date().toISOString(),
      }).eq('id', logEntry.id);
    } catch (err) {
      setUploadResult({ error: err.message });
      if (logEntry?.id) await supabase.from('ingestion_logs').update({
        status: 'failed', error_message: err.message, completed_at: new Date().toISOString(),
      }).eq('id', logEntry.id);
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  if (!tiktokAccount) return <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '13px', margin: 0 }}>No TikTok account found.</p>;

  return (
    <div>
      <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', margin: '0 0 10px' }}>
        Upload a CSV exported from TikTok Studio. Expected columns: Date, Video Views, Likes, Comments, Shares.
      </p>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        {uploadResult && (
          <span style={{ fontSize: '12px', fontWeight: 500, color: uploadResult.error ? '#f87171' : '#4ade80' }}>
            {uploadResult.error ? `Error: ${uploadResult.error}` : `${uploadResult.count} rows imported`}
          </span>
        )}
        <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
          style={{ ...styles.uploadBtn, borderColor: color + '66', color }}>
          {uploading ? 'Uploading...' : 'Upload TikTok CSV'}
        </button>
        <input ref={fileInputRef} type="file" accept=".csv" onChange={handleUpload} style={{ display: 'none' }} />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// Manual Metrics Form (Instagram, Facebook, Substack, Twitch)
// ═══════════════════════════════════════════════
function getDaysInRange(startStr, endStr) {
  const days = [];
  const start = new Date(startStr + 'T00:00:00');
  const end = new Date(endStr + 'T00:00:00');
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    days.push(d.toISOString().split('T')[0]);
  }
  return days;
}

function ManualMetricsForm({ platform, fields, accounts }) {
  const [startDate, setStartDate] = useState(daysAgoStr(30));
  const [endDate, setEndDate] = useState(todayStr());
  const [views, setViews] = useState('');
  const [revenue, setRevenue] = useState('');
  const [subscribers, setSubscribers] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  // Manage entries state
  const [showManage, setShowManage] = useState(false);
  const [entries, setEntries] = useState([]);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [deleteStart, setDeleteStart] = useState('');
  const [deleteEnd, setDeleteEnd] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteResult, setDeleteResult] = useState(null);
  const [selectedDates, setSelectedDates] = useState(new Set());

  const account = accounts.find(a => a.platform === platform);
  const meta = PLATFORM_META[platform] || {};
  const color = meta.color || '#666';

  const hasViews = fields.includes('views');
  const hasRevenue = fields.includes('revenue');
  const hasSubscribers = fields.includes('subscribers');

  async function loadEntries() {
    if (!account) return;
    setLoadingEntries(true);
    try {
      // Fetch platform_daily_metrics
      const { data: pdm } = await supabase.from('platform_daily_metrics')
        .select('id, date, views, likes, comments, shares')
        .eq('platform_account_id', account.id)
        .order('date', { ascending: false })
        .limit(200);

      // Fetch manual revenue_events
      const { data: rev } = await supabase.from('revenue_events')
        .select('id, stripe_event_id, occurred_at, net_amount_cents')
        .eq('platform_account_id', account.id)
        .like('stripe_event_id', `manual_${platform}_%`)
        .order('occurred_at', { ascending: false })
        .limit(200);

      // Fetch audience_snapshots
      const { data: aud } = await supabase.from('audience_snapshots')
        .select('id, date, followers_total')
        .eq('platform_account_id', account.id)
        .order('date', { ascending: false })
        .limit(200);

      // Merge by date
      const byDate = {};
      for (const row of (pdm || [])) {
        byDate[row.date] = { ...byDate[row.date], date: row.date, pdm_id: row.id, views: row.views, likes: row.likes, comments: row.comments, shares: row.shares };
      }
      for (const row of (rev || [])) {
        const d = row.occurred_at?.split('T')[0];
        if (d) byDate[d] = { ...byDate[d], date: d, rev_id: row.id, revenue_cents: row.net_amount_cents };
      }
      for (const row of (aud || [])) {
        byDate[row.date] = { ...byDate[row.date], date: row.date, aud_id: row.id, followers_total: row.followers_total };
      }
      setEntries(Object.values(byDate).sort((a, b) => b.date.localeCompare(a.date)));
    } catch (err) {
      console.error('Error loading entries:', err);
    }
    setLoadingEntries(false);
  }

  async function handleDeleteRange() {
    if (!account || !deleteStart || !deleteEnd) return;
    if (deleteStart > deleteEnd) { setDeleteResult({ error: 'Start must be before end' }); return; }
    if (!window.confirm(`Delete all manual ${meta.label} data from ${deleteStart} to ${deleteEnd}?`)) return;
    setDeleting(true); setDeleteResult(null);
    try {
      let deleted = 0;
      // Delete platform_daily_metrics
      if (hasViews) {
        const { data } = await supabase.from('platform_daily_metrics')
          .delete()
          .eq('platform_account_id', account.id)
          .gte('date', deleteStart)
          .lte('date', deleteEnd)
          .select('id');
        deleted += data?.length || 0;
      }
      // Delete manual revenue_events
      if (hasRevenue) {
        const days = getDaysInRange(deleteStart, deleteEnd);
        const eventIds = days.map(d => `manual_${platform}_${account.id}_${d}`);
        for (let i = 0; i < eventIds.length; i += 100) {
          const batch = eventIds.slice(i, i + 100);
          const { data } = await supabase.from('revenue_events')
            .delete()
            .in('stripe_event_id', batch)
            .select('id');
          deleted += data?.length || 0;
        }
      }
      // Delete audience_snapshots
      if (hasSubscribers) {
        const { data } = await supabase.from('audience_snapshots')
          .delete()
          .eq('platform_account_id', account.id)
          .gte('date', deleteStart)
          .lte('date', deleteEnd)
          .select('id');
        deleted += data?.length || 0;
      }
      setDeleteResult({ success: true, count: deleted });
      loadEntries();
    } catch (err) {
      setDeleteResult({ error: err.message });
    }
    setDeleting(false);
  }

  async function handleDeleteSingleDay(entry) {
    if (!account) return;
    if (!window.confirm(`Delete ${meta.label} data for ${entry.date}?`)) return;
    try {
      if (entry.pdm_id) await supabase.from('platform_daily_metrics').delete().eq('id', entry.pdm_id);
      if (entry.rev_id) await supabase.from('revenue_events').delete().eq('id', entry.rev_id);
      if (entry.aud_id) await supabase.from('audience_snapshots').delete().eq('id', entry.aud_id);
      setEntries(prev => prev.filter(e => e.date !== entry.date));
      setSelectedDates(prev => { const n = new Set(prev); n.delete(entry.date); return n; });
    } catch (err) {
      console.error('Delete error:', err);
    }
  }

  async function handleDeleteSelected() {
    if (!account || selectedDates.size === 0) return;
    if (!window.confirm(`Delete ${selectedDates.size} selected ${meta.label} entr${selectedDates.size === 1 ? 'y' : 'ies'}?`)) return;
    setDeleting(true); setDeleteResult(null);
    try {
      const selected = entries.filter(e => selectedDates.has(e.date));
      const pdmIds = selected.map(e => e.pdm_id).filter(Boolean);
      const revIds = selected.map(e => e.rev_id).filter(Boolean);
      const audIds = selected.map(e => e.aud_id).filter(Boolean);
      let deleted = 0;
      if (pdmIds.length) { const { data } = await supabase.from('platform_daily_metrics').delete().in('id', pdmIds).select('id'); deleted += data?.length || 0; }
      if (revIds.length) { const { data } = await supabase.from('revenue_events').delete().in('id', revIds).select('id'); deleted += data?.length || 0; }
      if (audIds.length) { const { data } = await supabase.from('audience_snapshots').delete().in('id', audIds).select('id'); deleted += data?.length || 0; }
      setEntries(prev => prev.filter(e => !selectedDates.has(e.date)));
      setSelectedDates(new Set());
      setDeleteResult({ success: true, count: deleted });
    } catch (err) {
      setDeleteResult({ error: err.message });
    }
    setDeleting(false);
  }

  function toggleSelectDate(date) {
    setSelectedDates(prev => {
      const n = new Set(prev);
      if (n.has(date)) n.delete(date); else n.add(date);
      return n;
    });
  }

  function toggleSelectAll() {
    if (selectedDates.size === entries.length) setSelectedDates(new Set());
    else setSelectedDates(new Set(entries.map(e => e.date)));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!account) return;
    if (startDate > endDate) { setResult({ error: 'Start date must be before end date' }); return; }
    setSubmitting(true); setResult(null);

    // Create ingestion log entry
    const { data: logEntry } = await supabase.from('ingestion_logs')
      .insert({ platform_account_id: account.id, job_type: `manual_input_${platform}`, status: 'running' })
      .select().single();

    try {
      const days = getDaysInRange(startDate, endDate);
      const numDays = days.length;
      let recordsProcessed = 0;

      // Views: split total evenly across days, remainder goes to last day
      if (hasViews && views) {
        const totalViews = parseInt(views, 10) || 0;
        const perDay = Math.floor(totalViews / numDays);
        const remainder = totalViews - perDay * numDays;
        const rows = days.map((d, i) => ({
          platform_account_id: account.id,
          date: d,
          views: perDay + (i === numDays - 1 ? remainder : 0),
          metadata: {},
        }));
        for (let i = 0; i < rows.length; i += 100) {
          const batch = rows.slice(i, i + 100);
          const { error } = await supabase.from('platform_daily_metrics')
            .upsert(batch, { onConflict: 'platform_account_id,date' });
          if (error) throw new Error(`Views: ${error.message}`);
        }
        recordsProcessed += rows.length;
      }

      // Revenue: split total evenly across days
      if (hasRevenue && revenue) {
        const totalCents = Math.round(parseFloat(revenue) * 100);
        if (totalCents > 0) {
          const perDay = Math.floor(totalCents / numDays);
          const remainder = totalCents - perDay * numDays;
          const rows = days.map((d, i) => ({
            stripe_event_id: `manual_${platform}_${account.id}_${d}`,
            event_type: 'charge',
            amount_cents: perDay + (i === numDays - 1 ? remainder : 0),
            net_amount_cents: perDay + (i === numDays - 1 ? remainder : 0),
            currency: 'usd',
            product_category: 'ad_revenue',
            is_recurring: false,
            occurred_at: `${d}T00:00:00Z`,
            metadata: { source: 'manual_input', platform },
            platform_account_id: account.id,
          }));
          for (let i = 0; i < rows.length; i += 100) {
            const batch = rows.slice(i, i + 100);
            const { error } = await supabase.from('revenue_events')
              .upsert(batch, { onConflict: 'stripe_event_id' });
            if (error) throw new Error(`Revenue: ${error.message}`);
          }
          recordsProcessed += rows.length;
        }
      }

      // Subscribers: use same total for each day (snapshot, not split)
      if (hasSubscribers && subscribers) {
        const subsNum = parseInt(subscribers, 10) || 0;
        if (subsNum > 0) {
          const rows = days.map(d => ({
            platform_account_id: account.id,
            date: d,
            followers_total: subsNum,
            followers_gained: 0,
            demographics: {},
            metadata: { source: 'manual_input' },
          }));
          for (let i = 0; i < rows.length; i += 100) {
            const batch = rows.slice(i, i + 100);
            const { error } = await supabase.from('audience_snapshots')
              .upsert(batch, { onConflict: 'platform_account_id,date' });
            if (error) throw new Error(`Subscribers: ${error.message}`);
          }
          recordsProcessed += rows.length;
        }
      }

      setResult({ success: true, days: numDays });
      setViews(''); setRevenue(''); setSubscribers('');

      if (logEntry?.id) await supabase.from('ingestion_logs').update({
        status: 'success', records_processed: recordsProcessed, records_created: recordsProcessed, completed_at: new Date().toISOString(),
      }).eq('id', logEntry.id);
    } catch (err) {
      setResult({ error: err.message });
      if (logEntry?.id) await supabase.from('ingestion_logs').update({
        status: 'failed', error_message: err.message, completed_at: new Date().toISOString(),
      }).eq('id', logEntry.id);
    }
    setSubmitting(false);
  }

  if (!account) return <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '13px', margin: 0 }}>No {meta.label} account found.</p>;

  return (
    <div>
      <form onSubmit={handleSubmit}>
        <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', margin: '0 0 10px' }}>
          Enter totals for the date range. Views and revenue are split evenly across days. Subscribers are set as a snapshot for each day.
        </p>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>Start Date</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
              style={{ ...styles.filterInput, padding: '8px 10px' }} required />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>End Date</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
              style={{ ...styles.filterInput, padding: '8px 10px' }} required />
          </div>
          {hasViews && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>Total Views</label>
              <input type="text" inputMode="numeric" pattern="[0-9]*" value={views}
                onChange={e => setViews(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="0" style={{ ...styles.filterInput, padding: '8px 10px', width: '120px' }} />
            </div>
          )}
          {hasRevenue && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>Total Revenue ($)</label>
              <input type="text" inputMode="decimal" value={revenue}
                onChange={e => setRevenue(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder="0.00" style={{ ...styles.filterInput, padding: '8px 10px', width: '120px' }} />
            </div>
          )}
          {hasSubscribers && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>Subscribers</label>
              <input type="text" inputMode="numeric" pattern="[0-9]*" value={subscribers}
                onChange={e => setSubscribers(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="0" style={{ ...styles.filterInput, padding: '8px 10px', width: '120px' }} />
            </div>
          )}
          <button type="submit" disabled={submitting}
            style={{ ...styles.uploadBtn, borderColor: color + '66', color, opacity: submitting ? 0.5 : 1 }}>
            {submitting ? 'Saving...' : 'Save'}
          </button>
          {result && (
            <span style={{ fontSize: '12px', fontWeight: 500, color: result.error ? '#f87171' : '#4ade80' }}>
              {result.error ? `Error: ${result.error}` : `Saved across ${result.days} day${result.days > 1 ? 's' : ''}`}
            </span>
          )}
        </div>
      </form>

      {/* Manage Entries */}
      <div style={{ marginTop: '16px' }}>
        <button onClick={() => { setShowManage(!showManage); if (!showManage) loadEntries(); }}
          style={{ ...styles.collapseBtn, width: 'auto', fontSize: '12px', padding: '6px 14px' }}>
          {showManage ? '▾' : '▸'} Manage Entries
        </button>
        {showManage && (
          <div style={{ marginTop: '10px', padding: '12px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px' }}>
            {/* Delete range */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '12px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <label style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)', fontWeight: 600, textTransform: 'uppercase' }}>Delete from</label>
                <input type="date" value={deleteStart} onChange={e => setDeleteStart(e.target.value)}
                  style={{ ...styles.filterInput, padding: '6px 8px', fontSize: '11px' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <label style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)', fontWeight: 600, textTransform: 'uppercase' }}>to</label>
                <input type="date" value={deleteEnd} onChange={e => setDeleteEnd(e.target.value)}
                  style={{ ...styles.filterInput, padding: '6px 8px', fontSize: '11px' }} />
              </div>
              <button onClick={handleDeleteRange} disabled={deleting || !deleteStart || !deleteEnd}
                style={{ padding: '6px 14px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px', color: '#f87171', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', opacity: deleting ? 0.5 : 1 }}>
                {deleting ? 'Deleting...' : 'Delete Range'}
              </button>
              {selectedDates.size > 0 && (
                <button onClick={handleDeleteSelected} disabled={deleting}
                  style={{ padding: '6px 14px', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: '6px', color: '#f87171', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', opacity: deleting ? 0.5 : 1 }}>
                  {deleting ? 'Deleting...' : `Delete Selected (${selectedDates.size})`}
                </button>
              )}
              {deleteResult && (
                <span style={{ fontSize: '11px', fontWeight: 500, color: deleteResult.error ? '#f87171' : '#4ade80' }}>
                  {deleteResult.error ? deleteResult.error : `${deleteResult.count} record${deleteResult.count !== 1 ? 's' : ''} deleted`}
                </span>
              )}
            </div>

            {/* Entries table */}
            {loadingEntries ? (
              <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.3)', margin: 0 }}>Loading...</p>
            ) : entries.length === 0 ? (
              <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.3)', margin: 0 }}>No entries found.</p>
            ) : (
              <div style={{ maxHeight: '300px', overflow: 'auto', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr>
                      <th style={{ padding: '6px 6px 6px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', position: 'sticky', top: 0, background: '#1a1a2e', width: '28px' }}>
                        <input type="checkbox" checked={selectedDates.size === entries.length && entries.length > 0} onChange={toggleSelectAll}
                          style={{ cursor: 'pointer', accentColor: color }} />
                      </th>
                      <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: '10px', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.06)', position: 'sticky', top: 0, background: '#1a1a2e' }}>Date</th>
                      {hasViews && <th style={{ padding: '6px 10px', textAlign: 'right', fontSize: '10px', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.06)', position: 'sticky', top: 0, background: '#1a1a2e' }}>Views</th>}
                      {hasRevenue && <th style={{ padding: '6px 10px', textAlign: 'right', fontSize: '10px', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.06)', position: 'sticky', top: 0, background: '#1a1a2e' }}>Revenue</th>}
                      {hasSubscribers && <th style={{ padding: '6px 10px', textAlign: 'right', fontSize: '10px', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.06)', position: 'sticky', top: 0, background: '#1a1a2e' }}>Subs</th>}
                      <th style={{ padding: '6px 10px', textAlign: 'right', fontSize: '10px', color: 'rgba(255,255,255,0.4)', borderBottom: '1px solid rgba(255,255,255,0.06)', position: 'sticky', top: 0, background: '#1a1a2e', width: '40px' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map(entry => (
                      <tr key={entry.date} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', background: selectedDates.has(entry.date) ? 'rgba(255,255,255,0.03)' : 'transparent' }}>
                        <td style={{ padding: '5px 6px 5px 10px' }}>
                          <input type="checkbox" checked={selectedDates.has(entry.date)} onChange={() => toggleSelectDate(entry.date)}
                            style={{ cursor: 'pointer', accentColor: color }} />
                        </td>
                        <td style={{ padding: '5px 10px', color: 'rgba(255,255,255,0.6)' }}>{entry.date}</td>
                        {hasViews && <td style={{ padding: '5px 10px', color: 'rgba(255,255,255,0.6)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{entry.views != null ? Number(entry.views).toLocaleString() : '—'}</td>}
                        {hasRevenue && <td style={{ padding: '5px 10px', color: 'rgba(255,255,255,0.6)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{entry.revenue_cents != null ? '$' + (entry.revenue_cents / 100).toFixed(2) : '—'}</td>}
                        {hasSubscribers && <td style={{ padding: '5px 10px', color: 'rgba(255,255,255,0.6)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{entry.followers_total != null ? Number(entry.followers_total).toLocaleString() : '—'}</td>}
                        <td style={{ padding: '5px 10px', textAlign: 'right' }}>
                          <button onClick={() => handleDeleteSingleDay(entry)}
                            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.25)', cursor: 'pointer', fontSize: '13px', padding: '2px 4px' }}
                            title={`Delete ${entry.date}`}>✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// YouTube CSV Upload (preserved from original)
// ═══════════════════════════════════════════════
const YT_CSV_PLATFORMS = [
  { key: 'youtube_trevormay', label: 'Trevor May Baseball', channel: 'trevormay', color: '#ff0000' },
  { key: 'youtube_moremayday', label: 'More Mayday', channel: 'moremayday', color: '#ff4444' },
];

function YouTubeCSVUpload({ profile }) {
  const [csvPlatform, setCsvPlatform] = useState(YT_CSV_PLATFORMS[0].key);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const fileInputRef = useRef(null);
  const videoFileInputRef = useRef(null);

  const platform = YT_CSV_PLATFORMS.find(p => p.key === csvPlatform);

  async function handleDailyUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true); setUploadResult(null);
    try {
      const text = await file.text();
      const parsed = parseCSV(text);
      const { rows, dateRange } = mapDailyCSV(platform.channel, parsed, profile.id);
      if (!rows.length) throw new Error('No valid rows found');
      let inserted = 0;
      for (let i = 0; i < rows.length; i += 100) {
        const batch = rows.slice(i, i + 100);
        const { data: result, error } = await supabase.from('analytics_youtube_daily')
          .upsert(batch, { onConflict: 'channel,date' }).select();
        if (error) { console.error(error); continue; }
        inserted += result?.length || 0;
      }
      await supabase.from('analytics_uploads').insert({
        platform: platform.key, filename: file.name, row_count: inserted,
        date_range_start: dateRange.start, date_range_end: dateRange.end, uploaded_by: profile.id,
      });
      setUploadResult({ success: true, count: inserted, type: 'daily' });
    } catch (err) { setUploadResult({ error: err.message }); }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleVideoUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true); setUploadResult(null);
    try {
      const text = await file.text();
      const parsed = parseCSV(text);
      const { rows, dateRange } = mapVideoCSV(platform.channel, parsed, profile.id);
      if (!rows.length) throw new Error('No valid rows found');
      let inserted = 0;
      for (let i = 0; i < rows.length; i += 100) {
        const batch = rows.slice(i, i + 100);
        const { data: result, error } = await supabase.from('analytics_youtube')
          .upsert(batch, { onConflict: 'channel,video_id' }).select();
        if (error) { console.error(error); continue; }
        inserted += result?.length || 0;
      }
      await supabase.from('analytics_uploads').insert({
        platform: platform.key, filename: file.name, row_count: inserted,
        date_range_start: dateRange.start, date_range_end: dateRange.end, uploaded_by: profile.id,
      });
      setUploadResult({ success: true, count: inserted, type: 'video' });
    } catch (err) { setUploadResult({ error: err.message }); }
    setUploading(false);
    if (videoFileInputRef.current) videoFileInputRef.current.value = '';
  }

  return (
    <div style={{ padding: '16px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', marginTop: '8px' }}>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
        {YT_CSV_PLATFORMS.map(p => (
          <button key={p.key} onClick={() => setCsvPlatform(p.key)}
            style={{
              ...styles.filterChip,
              ...(csvPlatform === p.key ? { background: p.color + '22', borderColor: p.color + '66', color: p.color } : {}),
            }}>
            {p.label}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        {uploadResult && (
          <span style={{ fontSize: '12px', fontWeight: 500, color: uploadResult.error ? '#f87171' : '#4ade80' }}>
            {uploadResult.error ? `Error: ${uploadResult.error}` : `${uploadResult.count} ${uploadResult.type} rows imported`}
          </span>
        )}
        <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
          style={{ ...styles.uploadBtn, borderColor: (platform?.color || '#666') + '66', color: platform?.color || '#666' }}>
          {uploading ? 'Uploading...' : 'Upload Daily CSV'}
        </button>
        <input ref={fileInputRef} type="file" accept=".csv" onChange={handleDailyUpload} style={{ display: 'none' }} />
        <button onClick={() => videoFileInputRef.current?.click()} disabled={uploading}
          style={{ ...styles.uploadBtn, borderColor: (platform?.color || '#666') + '66', color: platform?.color || '#666' }}>
          {uploading ? 'Uploading...' : 'Upload Video CSV'}
        </button>
        <input ref={videoFileInputRef} type="file" accept=".csv" onChange={handleVideoUpload} style={{ display: 'none' }} />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// CSV Parsing (preserved from original)
// ═══════════════════════════════════════════════
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { headers: [], rows: [] };
  function splitRow(line) {
    const result = []; let current = ''; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') inQ = !inQ;
      else if (ch === ',' && !inQ) { result.push(current.trim()); current = ''; }
      else current += ch;
    }
    result.push(current.trim());
    return result;
  }
  const headers = splitRow(lines[0]).map(h => h.replace(/^"|"$/g, '').trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const vals = splitRow(lines[i]);
    const row = {};
    headers.forEach((h, idx) => { row[h] = vals[idx] || ''; });
    rows.push(row);
  }
  return { headers, rows };
}

function mapDailyCSV(channel, parsed, userId) {
  const { headers, rows } = parsed;
  const colMap = {
    'Date': '_date', 'Views': 'views', 'Engaged views': 'engaged_views',
    'Watch time (hours)': 'watch_time_hours', 'Average view duration': '_avg_dur',
    'Average percentage viewed (%)': 'average_percentage_viewed', 'Stayed to watch (%)': 'stayed_to_watch_pct',
    'Unique viewers': 'unique_viewers', 'New viewers': 'new_viewers', 'Returning viewers': 'returning_viewers',
    'Regular viewers': 'regular_viewers', 'Average views per viewer': 'average_views_per_viewer',
    'Subscribers': 'subscribers', 'Impressions': 'impressions',
    'Impressions click-through rate (%)': 'impressions_ctr',
    'Videos added': 'videos_added', 'Videos published': 'videos_published',
    'Estimated revenue (USD)': 'estimated_revenue', 'YouTube Premium (USD)': 'youtube_premium_revenue',
    'YouTube ad revenue (USD)': 'ad_revenue', 'Watch Page ads (USD)': 'watch_page_ads_revenue',
    'Estimated AdSense revenue (USD)': 'adsense_revenue', 'Ad impressions': 'ad_impressions',
    'CPM (USD)': 'cpm', 'RPM (USD)': 'rpm', 'YouTube Premium views': 'youtube_premium_views',
  };
  const headerMap = {};
  headers.forEach(h => { if (colMap[h]) headerMap[h] = colMap[h]; });

  const dbRows = []; let minD = null, maxD = null;
  for (const row of rows) {
    const dateH = Object.keys(headerMap).find(h => headerMap[h] === '_date');
    const rawDate = dateH ? row[dateH]?.trim() : '';
    if (!rawDate || rawDate.toLowerCase() === 'total') continue;
    const date = parseDate(rawDate);
    if (!date) continue;
    if (!minD || date < minD) minD = date;
    if (!maxD || date > maxD) maxD = date;

    const dbRow = { channel, date, uploaded_by: userId };
    for (const [csvH, dbF] of Object.entries(headerMap)) {
      if (dbF === '_date') continue;
      const raw = row[csvH];
      if (raw === '' || raw === undefined) continue;
      if (dbF === '_avg_dur') { const s = parseDuration(raw); if (s !== null) dbRow.average_view_duration_seconds = s; }
      else { const n = parseNumber(raw); if (n !== null) dbRow[dbF] = n; }
    }
    dbRows.push(dbRow);
  }
  return { rows: dbRows, dateRange: { start: minD, end: maxD } };
}

function mapVideoCSV(channel, parsed, userId) {
  const { headers, rows } = parsed;
  const colMap = {
    'Content': 'video_id', 'Video title': 'video_title', 'Video publish time': '_date', 'Duration': '_duration',
    'Views': 'views', 'Engaged views': 'engaged_views', 'Watch time (hours)': 'watch_time_hours',
    'Average view duration': '_avg_dur', 'Average percentage viewed (%)': 'average_percentage_viewed',
    'Stayed to watch (%)': 'stayed_to_watch_pct', 'Unique viewers': 'unique_viewers',
    'New viewers': 'new_viewers', 'Returning viewers': 'returning_viewers', 'Regular viewers': 'regular_viewers',
    'Subscribers': 'subscribers', 'Post subscribers': 'post_subscribers',
    'Impressions': 'impressions', 'Impressions click-through rate (%)': 'impressions_ctr',
    'Estimated revenue (USD)': 'estimated_revenue', 'YouTube Premium (USD)': 'youtube_premium_revenue',
    'YouTube ad revenue (USD)': 'ad_revenue', 'Watch Page ads (USD)': 'watch_page_ads_revenue',
    'Estimated AdSense revenue (USD)': 'adsense_revenue', 'Ad impressions': 'ad_impressions',
    'CPM (USD)': 'cpm', 'RPM (USD)': 'rpm', 'YouTube Premium views': 'youtube_premium_views',
  };
  const headerMap = {};
  headers.forEach(h => { if (colMap[h]) headerMap[h] = colMap[h]; });

  const dbRows = []; let minD = null, maxD = null;
  for (const row of rows) {
    const vidIdH = Object.keys(headerMap).find(h => headerMap[h] === 'video_id');
    const vidId = vidIdH ? row[vidIdH]?.trim() : '';
    if (!vidId || vidId.toLowerCase() === 'total') continue;

    const dbRow = { channel, uploaded_by: userId };
    for (const [csvH, dbF] of Object.entries(headerMap)) {
      const raw = row[csvH];
      if (raw === '' || raw === undefined) continue;
      if (dbF === '_date') { const d = parseDate(raw); if (d) { dbRow.publish_date = d; if (!minD || d < minD) minD = d; if (!maxD || d > maxD) maxD = d; } }
      else if (dbF === '_duration') { const s = parseDuration(raw); if (s !== null) dbRow.duration_seconds = s; }
      else if (dbF === '_avg_dur') { const s = parseDuration(raw); if (s !== null) dbRow.average_view_duration_seconds = s; }
      else if (dbF === 'video_id' || dbF === 'video_title') dbRow[dbF] = raw;
      else { const n = parseNumber(raw); if (n !== null) dbRow[dbF] = n; }
    }
    if (dbRow.video_id) dbRows.push(dbRow);
  }
  return { rows: dbRows, dateRange: { start: minD, end: maxD } };
}

// ═══════════════════════════════════════════════
// Helpers (preserved from original)
// ═══════════════════════════════════════════════
function parseDate(val) {
  if (!val) return null;
  const s = String(val).trim();
  const months = {jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
  const m = s.match(/^([A-Za-z]{3})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m && months[m[1].toLowerCase()]) return `${m[3]}-${months[m[1].toLowerCase()]}-${m[2].padStart(2,'0')}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
  const p = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (p) { const y = p[3].length===2?'20'+p[3]:p[3]; return `${y}-${p[1].padStart(2,'0')}-${p[2].padStart(2,'0')}`; }
  return null;
}
function parseDuration(val) {
  if (!val) return null;
  const s = String(val).trim();
  if (/^\d+$/.test(s)) return Number(s);
  const parts = s.split(':').map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length===3) return parts[0]*3600+parts[1]*60+parts[2];
  if (parts.length===2) return parts[0]*60+parts[1];
  return null;
}
function parseNumber(val) {
  if (val===''||val==null) return null;
  const n = Number(String(val).replace(/[,%$]/g,'').trim());
  return isNaN(n)?null:n;
}

// ═══════════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════════
const styles = {
  page: { padding: '32px 40px' },
  topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' },
  pageTitle: { fontSize: '28px', fontWeight: 700, color: '#fff', margin: '0 0 4px', letterSpacing: '-0.5px' },
  pageSubtitle: { fontSize: '14px', color: 'rgba(255,255,255,0.4)', margin: 0 },

  // Filters
  filterBar: { display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: '20px', padding: '12px 16px', background: 'rgba(255,255,255,0.02)', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.06)' },
  filterChip: { padding: '6px 14px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '20px', color: 'rgba(255,255,255,0.5)', fontSize: '12px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' },
  filterChipActive: { background: 'rgba(99,102,241,0.15)', borderColor: 'rgba(99,102,241,0.4)', color: '#a5b4fc' },
  filterSelect: { padding: '6px 10px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '20px', color: 'rgba(255,255,255,0.5)', fontSize: '12px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', outline: 'none', appearance: 'none', WebkitAppearance: 'none', paddingRight: '10px' },
  filterSelectActive: { background: 'rgba(99,102,241,0.15)', borderColor: 'rgba(99,102,241,0.4)', color: '#a5b4fc' },
  filterInput: { padding: '6px 10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#fff', fontSize: '12px', fontFamily: 'inherit', outline: 'none' },
  platformDot: { width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0 },
  platformDropdown: { position: 'absolute', top: '100%', right: 0, marginTop: '6px', background: '#1e1e36', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', padding: '6px', zIndex: 50, minWidth: '220px', display: 'flex', flexDirection: 'column', gap: '2px', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' },
  platformDropdownItem: { display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 12px', background: 'transparent', border: '1px solid transparent', borderRadius: '8px', color: 'rgba(255,255,255,0.5)', fontSize: '12px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', width: '100%' },
  platformDropdownClear: { padding: '5px 12px', background: 'transparent', border: 'none', borderRadius: '6px', color: 'rgba(255,255,255,0.3)', fontSize: '11px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', marginBottom: '2px' },

  // KPI
  kpiGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '20px' },
  kpiCard: { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '18px 22px', position: 'relative', overflow: 'hidden' },
  kpiAccent: { position: 'absolute', top: 0, left: 0, right: 0, height: '3px' },
  kpiLabel: { fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' },
  kpiValue: { fontSize: '26px', fontWeight: 700, color: '#fff', fontVariantNumeric: 'tabular-nums' },

  // Chart
  chartSection: { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '20px', marginBottom: '20px' },
  chartHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' },
  chartTitle: { fontSize: '15px', fontWeight: 700, color: '#fff' },
  metricChip: { padding: '5px 12px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '14px', color: 'rgba(255,255,255,0.4)', fontSize: '11px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' },
  metricChipActive: { background: 'rgba(99,102,241,0.15)', borderColor: 'rgba(99,102,241,0.4)', color: '#a5b4fc' },

  // Table
  tableHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' },
  tableTitle: { fontSize: '15px', fontWeight: 700, color: '#fff' },
  tableWrap: { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', overflow: 'auto', maxHeight: '600px', marginBottom: '20px' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '700px' },
  th: { padding: '10px 14px', textAlign: 'left', fontWeight: 600, fontSize: '11px', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid rgba(255,255,255,0.06)', position: 'sticky', top: 0, background: '#16162a', zIndex: 1, whiteSpace: 'nowrap', userSelect: 'none' },
  thSticky: { position: 'sticky', left: 0, zIndex: 3, background: '#16162a', minWidth: '200px', maxWidth: '300px' },
  td: { padding: '8px 14px', borderBottom: '1px solid rgba(255,255,255,0.03)', color: 'rgba(255,255,255,0.6)', whiteSpace: 'nowrap' },
  tdSticky: { position: 'sticky', left: 0, zIndex: 1, maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 500, color: '#e2e8f0' },
  tdValue: { fontWeight: 600, color: '#e2e8f0', fontVariantNumeric: 'tabular-nums' },
  trEven: { background: 'rgba(255,255,255,0.01)' },
  sortArrow: { marginLeft: '4px', color: '#a5b4fc' },

  // Misc
  loadingText: { padding: '40px', textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: '14px' },
  emptyCard: { background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '14px', padding: '32px', textAlign: 'center', marginBottom: '20px' },
  emptyText: { color: 'rgba(255,255,255,0.35)', fontSize: '14px', margin: 0 },
  uploadBtn: { padding: '8px 16px', background: 'rgba(255,255,255,0.04)', border: '1px solid', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  collapseBtn: { padding: '8px 16px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', color: 'rgba(255,255,255,0.5)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', width: '100%', textAlign: 'left' },
};
