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
  fourthwall:{ label: 'Fourthwall',color: '#E8451C', icon: 'FW' },
};

const REVENUE_CATEGORIES = {
  merch:        { label: 'Merch',          color: '#f97316' },
  subscription: { label: 'Subscriptions',  color: '#8b5cf6' },
  sponsorship:  { label: 'Sponsorships',   color: '#10b981' },
  ad_revenue:   { label: 'Ad Revenue',     color: '#3b82f6' },
  other:        { label: 'Other',          color: '#6b7280' },
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
  { key: 'views',      label: 'Views',      color: '#6366f1', getValue: r => r.total_views || 0 },
  { key: 'revenue',    label: 'Revenue',    color: '#f59e0b', getValue: r => (r.revenue_cents || 0) / 100 },
  { key: 'engagement', label: 'Engagement', color: '#22c55e', getValue: r => (r.avg_engagement_rate || 0) * 100 },
  { key: 'followers',  label: 'Followers',  color: '#ec4899', getValue: r => r.followers_eod || 0 },
];

const LINE_COLORS = ['#6366f1', '#f59e0b', '#22c55e', '#ec4899', '#3b82f6', '#a855f7', '#14b8a6'];

const BUCKET_DEFS = {
  spring_training: { startMonth: 2, startDay: 15, endMonth: 4, endDay: 1, label: 'Spring Training' },
  regular_season:  { startMonth: 4, startDay: 1, endMonth: 10, endDay: 1, label: 'Regular Season' },
  post_season:     { startMonth: 10, startDay: 1, endMonth: 11, endDay: 1, label: 'Post Season' },
  in_season:       { startMonth: 2, startDay: 15, endMonth: 11, endDay: 1, label: 'In Season' },
  off_season:      { startMonth: 11, startDay: 1, endMonth: 2, endDay: 15, label: 'Off Season', crossesYear: true },
};

const ROW_SPLITS = [
  { key: 'content', label: 'Content' },
  { key: 'day', label: 'Date (Day)' },
  { key: 'month', label: 'Date (Month)' },
  { key: 'year', label: 'Date (Year)' },
  ...Object.entries(BUCKET_DEFS).map(([k, v]) => ({ key: `bucket_${k}`, label: v.label })),
];

const AVAILABLE_METRICS = [
  // Platform Rollups
  { key: 'views', label: 'Views', group: 'Platform Rollups', table: 'daily_platform_rollups', format: v => formatCompact(v), getValue: r => Number(r.total_views) || 0 },
  { key: 'revenue', label: 'Revenue', group: 'Platform Rollups', table: 'daily_platform_rollups', format: v => '$' + (v / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), getValue: r => Number(r.revenue_cents) || 0 },
  { key: 'avg_engagement', label: 'Avg Engagement', group: 'Platform Rollups', table: 'daily_platform_rollups', format: v => (v * 100).toFixed(2) + '%', getValue: r => Number(r.avg_engagement_rate) || 0, aggregate: 'avg' },
  { key: 'followers_eod', label: 'Followers EOD', group: 'Platform Rollups', table: 'daily_platform_rollups', format: v => formatCompact(v), getValue: r => Number(r.followers_eod) || 0, aggregate: 'last' },
  // Content Metrics
  { key: 'content_views', label: 'Views', group: 'Content Metrics', table: 'content_metrics', format: v => formatCompact(v), contentOnly: true },
  { key: 'content_likes', label: 'Likes', group: 'Content Metrics', table: 'content_metrics', format: v => formatCompact(v), contentOnly: true },
  { key: 'content_comments', label: 'Comments', group: 'Content Metrics', table: 'content_metrics', format: v => formatCompact(v), contentOnly: true },
  { key: 'content_shares', label: 'Shares', group: 'Content Metrics', table: 'content_metrics', format: v => formatCompact(v), contentOnly: true },
  { key: 'content_engagement', label: 'Engagement Rate', group: 'Content Metrics', table: 'content_metrics', format: v => (v * 100).toFixed(2) + '%', contentOnly: true },
  // YouTube Daily
  { key: 'yt_watch_time', label: 'Watch Time (hrs)', group: 'YouTube', table: 'analytics_youtube_daily', format: v => formatCompact(v), getValue: r => Number(r.watch_time_hours) || 0 },
  { key: 'yt_impressions', label: 'Impressions', group: 'YouTube', table: 'analytics_youtube_daily', format: v => formatCompact(v), getValue: r => Number(r.impressions) || 0 },
  { key: 'yt_ctr', label: 'Impressions CTR', group: 'YouTube', table: 'analytics_youtube_daily', format: v => v.toFixed(2) + '%', getValue: r => Number(r.impressions_ctr) || 0, aggregate: 'avg' },
  { key: 'yt_subscribers', label: 'Subscribers', group: 'YouTube', table: 'analytics_youtube_daily', format: v => formatCompact(v), getValue: r => Number(r.subscribers) || 0 },
  { key: 'yt_est_revenue', label: 'Est. Revenue', group: 'YouTube', table: 'analytics_youtube_daily', format: v => '$' + v.toFixed(2), getValue: r => Number(r.estimated_revenue) || 0 },
  { key: 'yt_ad_revenue', label: 'Ad Revenue', group: 'YouTube', table: 'analytics_youtube_daily', format: v => '$' + v.toFixed(2), getValue: r => Number(r.ad_revenue) || 0 },
  { key: 'yt_cpm', label: 'CPM', group: 'YouTube', table: 'analytics_youtube_daily', format: v => '$' + v.toFixed(2), getValue: r => Number(r.cpm) || 0, aggregate: 'avg' },
  { key: 'yt_rpm', label: 'RPM', group: 'YouTube', table: 'analytics_youtube_daily', format: v => '$' + v.toFixed(2), getValue: r => Number(r.rpm) || 0, aggregate: 'avg' },
  { key: 'yt_unique_viewers', label: 'Unique Viewers', group: 'YouTube', table: 'analytics_youtube_daily', format: v => formatCompact(v), getValue: r => Number(r.unique_viewers) || 0 },
  { key: 'yt_new_viewers', label: 'New Viewers', group: 'YouTube', table: 'analytics_youtube_daily', format: v => formatCompact(v), getValue: r => Number(r.new_viewers) || 0 },
  { key: 'yt_returning_viewers', label: 'Returning Viewers', group: 'YouTube', table: 'analytics_youtube_daily', format: v => formatCompact(v), getValue: r => Number(r.returning_viewers) || 0 },
];

const COMPARISON_METRICS = AVAILABLE_METRICS.filter(m => !m.contentOnly);

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

function getBucketDateRange(bucketKey, year) {
  const def = BUCKET_DEFS[bucketKey];
  if (!def) return null;
  if (def.crossesYear) {
    return {
      start: `${year}-${String(def.startMonth).padStart(2, '0')}-${String(def.startDay).padStart(2, '0')}`,
      end: `${year + 1}-${String(def.endMonth).padStart(2, '0')}-${String(def.endDay).padStart(2, '0')}`,
      label: `${year} ${def.label}`,
    };
  }
  return {
    start: `${year}-${String(def.startMonth).padStart(2, '0')}-${String(def.startDay).padStart(2, '0')}`,
    end: `${year}-${String(def.endMonth).padStart(2, '0')}-${String(def.endDay).padStart(2, '0')}`,
    label: `${year} ${def.label}`,
  };
}

function getYearsInRange(startStr, endStr) {
  const startY = new Date(startStr).getFullYear();
  const endY = new Date(endStr).getFullYear();
  const years = [];
  for (let y = startY; y <= endY; y++) years.push(y);
  return years;
}

function getContentTypeAccountIds(accounts, activeAccountIds, contentTypeFilter) {
  if (!contentTypeFilter || contentTypeFilter === 'all') {
    return activeAccountIds.length > 0 ? activeAccountIds : accounts.map(a => a.id);
  }
  const shortFormPlatforms = ['tiktok', 'instagram', 'facebook'];
  const longFormPlatforms = ['youtube', 'twitch'];
  const editorialPlatforms = ['substack'];
  let platforms;
  if (contentTypeFilter === 'short') platforms = shortFormPlatforms;
  else if (contentTypeFilter === 'long') platforms = longFormPlatforms;
  else if (contentTypeFilter === 'editorial') platforms = editorialPlatforms;
  else return activeAccountIds.length > 0 ? activeAccountIds : accounts.map(a => a.id);
  const filtered = accounts.filter(a => platforms.includes(a.platform));
  const ids = filtered.map(a => a.id);
  if (activeAccountIds.length > 0) return ids.filter(id => activeAccountIds.includes(id));
  return ids;
}

/** Parse a date string that may be "YYYY-MM-DD" or "YYYY-MM-DD HH:MM:SS" into a local Date */
function toLocalDate(s) {
  return new Date(String(s).slice(0, 10) + 'T00:00:00');
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
  const [platformDropdownOpen, setPlatformDropdownOpen] = useState(false);
  const [contentRefreshing, setContentRefreshing] = useState(false);
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

  // Content performance (collapsible)
  const [showContentPerf, setShowContentPerf] = useState(false);

  // Ingestion health (admin)
  const [showIngestion, setShowIngestion] = useState(false);
  const [ingestionLogs, setIngestionLogs] = useState([]);
  const [viewMode, setViewMode] = useState('dashboard');
  const [sponsorshipRevenue, setSponsorshipRevenue] = useState(0);

  // Analysis tools
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [analysisData, setAnalysisData] = useState({ revenue: [], contentWithMetrics: [], audienceSnapshots: [] });

  // Platform sync refresh
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null);

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

  // Auto-refresh content performance every 5 minutes
  useEffect(() => {
    const interval = setInterval(() => {
      fetchContentPerformance();
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [dateRange, customStart, customEnd, filterMonth, filterYear, activeAccountIds.join(',')]);

  async function handleContentRefresh() {
    setContentRefreshing(true);
    await fetchContentPerformance();
    setContentRefreshing(false);
  }

  async function fetchAllData() {
    setLoading(true);
    await Promise.all([
      fetchKPI(),
      fetchTimeSeries(),
      fetchContentPerformance(),
      fetchAnalysisData(),
    ]);
    setLoading(false);
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
      setTimeout(() => setSyncStatus(null), 5000);
    }
  }

  async function fetchAnalysisData() {
    const { start, end } = getDateRange(dateRange, customStart, customEnd, filterMonth, filterYear);
    const [revResult, contentResult, audResult] = await Promise.all([
      // Revenue by account
      supabase
        .from('revenue_events')
        .select('platform_account_id, amount_cents, net_amount_cents, event_type')
        .gte('occurred_at', start)
        .lte('occurred_at', end + 'T23:59:59')
        .in('event_type', ['charge', 'subscription_renewal']),
      // Content items with metrics
      supabase
        .from('content_items')
        .select('id, title, published_at, platform_account_id, url, platform_account:platform_accounts(platform, account_name), latest_metrics:content_metrics(views, likes, comments, shares, engagement_rate)')
        .gte('published_at', start)
        .lte('published_at', end + 'T23:59:59')
        .order('published_at', { ascending: false })
        .limit(500),
      // Audience snapshots for follower growth
      supabase
        .from('audience_snapshots')
        .select('date, followers_gained, platform_account_id')
        .gte('date', start)
        .lte('date', end),
    ]);
    setAnalysisData({
      revenue: revResult.data || [],
      contentWithMetrics: contentResult.data || [],
      audienceSnapshots: audResult.data || [],
    });
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
      .in('event_type', ['charge', 'subscription_renewal', 'sponsorship']);
    if (activeAccountIds.length > 0) rq = rq.or(`platform_account_id.in.(${activeAccountIds.join(',')}),platform_account_id.is.null`);
    const { data: revenue } = await rq;

    let prq = supabase
      .from('revenue_events')
      .select('net_amount_cents')
      .gte('occurred_at', prevStart)
      .lt('occurred_at', start)
      .in('event_type', ['charge', 'subscription_renewal', 'sponsorship']);
    if (activeAccountIds.length > 0) prq = prq.or(`platform_account_id.in.(${activeAccountIds.join(',')}),platform_account_id.is.null`);
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
    const sponsorRev = (revenue || []).filter(r => r.event_type === 'sponsorship').reduce((s, r) => s + r.net_amount_cents, 0);
    setSponsorshipRevenue(sponsorRev);
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
      if (fol > 0) byAccount[key].followers = fol; // use latest non-zero value (overwritten as we iterate sorted by date)
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

  // ── Revenue donut (includes sponsorships) ──
  const revenueDonutData = useMemo(() => {
    const entries = platformBreakdown.filter(p => p.revenue > 0).map(p => ({ ...p }));
    if (sponsorshipRevenue > 0) {
      entries.push({
        label: 'Sponsorships',
        revenue: sponsorshipRevenue,
        color: REVENUE_CATEGORIES.sponsorship.color,
      });
    }
    return entries;
  }, [platformBreakdown, sponsorshipRevenue]);

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
      {viewMode !== 'advanced' && <div style={styles.filterBar}>
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
        <button onClick={() => setViewMode('revenues')} style={viewMode === 'revenues' ? styles.viewToggleBtnActive : styles.viewToggleBtn}>Revenues</button>
        <button onClick={() => setViewMode('advanced')} style={viewMode === 'advanced' ? styles.viewToggleBtnActive : styles.viewToggleBtn}>Advanced</button>
      </div>

      {viewMode === 'revenues' && (
        <RevenuesView accounts={accounts} start={start} end={end} activeAccountIds={activeAccountIds} />
      )}

      {viewMode === 'advanced' && (
        <AdvancedView accounts={accounts} />
      )}

      {viewMode === 'dashboard' && (loading ? <p style={styles.loadingText}>Loading analytics...</p> : (
        <>
          {/* ── Dashboard Sections ── */}
          {/* ── B. KPI Summary Cards ── */}
          {kpi && (
            <div style={styles.kpiGrid}>
              <KPICard label="Total Views" value={Number(kpi.totalViews).toLocaleString()} change={kpi.viewsChange} color="#6366f1" />
              <KPICard label="Total Revenue" value={formatCurrency(kpi.totalRevenue)} change={kpi.revenueChange} color="#22c55e" />
              <KPICard label="Net Followers" value={Number(kpi.totalFollowers).toLocaleString()}
                change={kpi.followersChange} changeLabel={`${kpi.followersChange >= 0 ? '+' : ''}${Number(kpi.followersChange).toLocaleString()} this period`} color="#3b82f6" />
              <KPICard label="Avg Engagement" value={(kpi.avgEngagement * 100).toFixed(2) + '%'} change={kpi.engagementChange} color="#f59e0b" />
            </div>
          )}

          {/* ── C. Trend Chart ── */}
          <div style={styles.chartSection}>
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
              {/* Revenue */}
              {revenueDonutData.length > 0 && (
                <div style={{ ...styles.chartSection, flex: '1 1 340px', minWidth: '300px', borderLeft: '3px solid #f59e0b' }}>
                  <span style={{ ...styles.chartTitle, color: '#f59e0b' }}>Revenue by Source</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '24px', marginTop: '16px', flexWrap: 'wrap' }}>
                    <DonutChart data={revenueDonutData} valueKey="revenue" centerLabel="total revenue"
                      formatValue={v => '$' + formatCompact(v / 100)} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {revenueDonutData.map(p => {
                        const total = revenueDonutData.reduce((s, x) => s + x.revenue, 0);
                        return (
                          <div key={p.label} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ width: '10px', height: '10px', borderRadius: '3px', background: p.color, flexShrink: 0 }} />
                            <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)', minWidth: '70px' }}>{p.label}</span>
                            <span style={{ fontSize: '12px', fontWeight: 600, color: '#fff' }}>${(p.revenue / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)' }}>({(total > 0 ? (p.revenue / total) * 100 : 0).toFixed(1)}%)</span>
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

// ═══════════════════════════════════════════════
// Revenues View
// ═══════════════════════════════════════════════
function RevenuesView({ accounts, start, end, activeAccountIds }) {
  const [subView, setSubView] = useState('overview');
  const [revData, setRevData] = useState({ byCategory: {}, events: [], trendData: [] });
  const [prevByCategory, setPrevByCategory] = useState({});
  const [revLoading, setRevLoading] = useState(true);
  const [catFilter, setCatFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [sortCol, setSortCol] = useState('occurred_at');
  const [sortDir, setSortDir] = useState('desc');

  // Compute previous period
  const daySpan = Math.max(1, Math.ceil((new Date(end) - new Date(start)) / 86400000));
  const prevStart = daysAgoStr(daySpan * 2 + Math.ceil((new Date() - new Date(end)) / 86400000));
  const prevEnd = start;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setRevLoading(true);

      const accountFilter = activeAccountIds.length > 0
        ? `platform_account_id.in.(${activeAccountIds.join(',')}),platform_account_id.is.null`
        : undefined;

      // Current period by category
      let q = supabase
        .from('revenue_events')
        .select('net_amount_cents, product_category, event_type, occurred_at')
        .gte('occurred_at', start)
        .lte('occurred_at', end)
        .in('event_type', ['charge', 'subscription_renewal', 'sponsorship']);
      if (accountFilter) q = q.or(accountFilter);
      const { data: current } = await q;

      // Previous period
      let pq = supabase
        .from('revenue_events')
        .select('net_amount_cents, product_category')
        .gte('occurred_at', prevStart)
        .lt('occurred_at', prevEnd)
        .in('event_type', ['charge', 'subscription_renewal', 'sponsorship']);
      if (accountFilter) pq = pq.or(accountFilter);
      const { data: prev } = await pq;

      // All events for table
      let eq = supabase
        .from('revenue_events')
        .select('id, net_amount_cents, product_category, event_type, occurred_at, description, platform_account_id, platform_accounts(platform, account_name)')
        .gte('occurred_at', start)
        .lte('occurred_at', end)
        .in('event_type', ['charge', 'subscription_renewal', 'sponsorship'])
        .order('occurred_at', { ascending: false });
      if (accountFilter) eq = eq.or(accountFilter);
      const { data: events } = await eq;

      if (cancelled) return;

      // Aggregate by category
      const byCategory = {};
      for (const r of (current || [])) {
        const cat = r.product_category || 'other';
        byCategory[cat] = (byCategory[cat] || 0) + r.net_amount_cents;
      }
      const prevByCat = {};
      for (const r of (prev || [])) {
        const cat = r.product_category || 'other';
        prevByCat[cat] = (prevByCat[cat] || 0) + r.net_amount_cents;
      }

      // Trend data: daily totals per category
      const dailyMap = {};
      for (const r of (current || [])) {
        const day = String(r.occurred_at).slice(0, 10);
        const cat = r.product_category || 'other';
        if (!dailyMap[day]) dailyMap[day] = { date: day };
        dailyMap[day][cat] = (dailyMap[day][cat] || 0) + r.net_amount_cents;
      }
      const trendData = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

      setRevData({ byCategory, events: events || [], trendData });
      setPrevByCategory(prevByCat);
      setRevLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [start, end, activeAccountIds.join(',')]);

  function handleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('desc'); }
  }

  // Donut data
  const donutData = Object.entries(revData.byCategory)
    .filter(([, v]) => v > 0)
    .map(([cat, amount]) => ({
      label: REVENUE_CATEGORIES[cat]?.label || cat,
      color: REVENUE_CATEGORIES[cat]?.color || '#6b7280',
      amount: amount / 100,
    }));

  // Trend metrics for chart
  const activeCategories = Object.keys(revData.byCategory).filter(k => revData.byCategory[k] > 0);
  const trendMetrics = activeCategories.map(cat => ({
    key: cat,
    label: REVENUE_CATEGORIES[cat]?.label || cat,
    color: REVENUE_CATEGORIES[cat]?.color || '#6b7280',
    getValue: r => ((r[cat] || 0) / 100),
    formatValue: v => '$' + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  }));

  // Filter and sort events
  const filteredEvents = useMemo(() => {
    let rows = revData.events;
    if (catFilter !== 'all') rows = rows.filter(r => (r.product_category || 'other') === catFilter);
    if (typeFilter !== 'all') rows = rows.filter(r => r.event_type === typeFilter);
    return [...rows].sort((a, b) => {
      let va, vb;
      if (sortCol === 'occurred_at') { va = a.occurred_at || ''; vb = b.occurred_at || ''; }
      else if (sortCol === 'net_amount_cents') { va = a.net_amount_cents || 0; vb = b.net_amount_cents || 0; }
      else if (sortCol === 'product_category') { va = a.product_category || ''; vb = b.product_category || ''; }
      else if (sortCol === 'event_type') { va = a.event_type || ''; vb = b.event_type || ''; }
      else { va = a[sortCol] || ''; vb = b[sortCol] || ''; }
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortDir === 'asc' ? va - vb : vb - va;
    });
  }, [revData.events, catFilter, typeFilter, sortCol, sortDir]);

  const eventTypes = useMemo(() => [...new Set(revData.events.map(r => r.event_type))], [revData.events]);

  if (revLoading) return <p style={styles.loadingText}>Loading revenue data...</p>;

  return (
    <>
      {/* Sub-toggle */}
      <div style={styles.viewToggleBar}>
        <button onClick={() => setSubView('overview')} style={subView === 'overview' ? styles.viewToggleBtnActive : styles.viewToggleBtn}>Overview</button>
        <button onClick={() => setSubView('advanced')} style={subView === 'advanced' ? styles.viewToggleBtnActive : styles.viewToggleBtn}>Advanced</button>
      </div>

      {subView === 'overview' && (
        <>
          {/* KPI Cards */}
          <div style={styles.kpiGrid}>
            {Object.entries(REVENUE_CATEGORIES).map(([cat, meta]) => {
              const amount = revData.byCategory[cat] || 0;
              const prev = prevByCategory[cat] || 0;
              const change = pctChange(amount, prev);
              return (
                <KPICard
                  key={cat}
                  label={meta.label}
                  value={formatCurrency(amount)}
                  change={change}
                  color={meta.color}
                />
              );
            })}
          </div>

          {/* Revenue by Source Donut */}
          <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
            {donutData.length > 0 && (
              <div style={{ ...styles.chartSection, flex: '1 1 340px', minWidth: '300px', borderLeft: '3px solid #f59e0b' }}>
                <span style={{ ...styles.chartTitle, color: '#f59e0b' }}>Revenue by Source</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '24px', marginTop: '16px', flexWrap: 'wrap' }}>
                  <DonutChart data={donutData} valueKey="amount" centerLabel="total revenue"
                    formatValue={v => '$' + formatCompact(v)} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {donutData.map(p => {
                      const total = donutData.reduce((s, x) => s + x.amount, 0);
                      return (
                        <div key={p.label} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ width: '10px', height: '10px', borderRadius: '3px', background: p.color, flexShrink: 0 }} />
                          <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)', minWidth: '100px' }}>{p.label}</span>
                          <span style={{ fontSize: '12px', fontWeight: 600, color: '#fff' }}>${p.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)' }}>({(total > 0 ? (p.amount / total) * 100 : 0).toFixed(1)}%)</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Revenue Over Time */}
          {revData.trendData.length > 0 && trendMetrics.length > 0 && (
            <div style={styles.chartSection}>
              <div style={styles.chartHeader}>
                <span style={styles.chartTitle}>Revenue Over Time</span>
                <div style={{ display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap' }}>
                  {trendMetrics.map(m => (
                    <div key={m.key} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: m.color, flexShrink: 0 }} />
                      <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', fontWeight: 500 }}>{m.label}</span>
                    </div>
                  ))}
                </div>
              </div>
              <TrendChart data={revData.trendData} metrics={trendMetrics} />
            </div>
          )}
        </>
      )}

      {subView === 'advanced' && (
        <>
          {/* Filters */}
          <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={catFilter} onChange={e => setCatFilter(e.target.value)} style={styles.select}>
              <option value="all">All Categories</option>
              {Object.entries(REVENUE_CATEGORIES).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={styles.select}>
              <option value="all">All Types</option>
              {eventTypes.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginLeft: 'auto' }}>
              {filteredEvents.length} event{filteredEvents.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Events Table */}
          {filteredEvents.length > 0 ? (
            <div style={styles.tableWrap}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={{ ...styles.th, cursor: 'pointer' }} onClick={() => handleSort('occurred_at')}>
                      Date {sortCol === 'occurred_at' && <span style={styles.sortArrow}>{sortDir === 'asc' ? '↑' : '↓'}</span>}
                    </th>
                    <th style={{ ...styles.th, cursor: 'pointer' }} onClick={() => handleSort('event_type')}>
                      Type {sortCol === 'event_type' && <span style={styles.sortArrow}>{sortDir === 'asc' ? '↑' : '↓'}</span>}
                    </th>
                    <th style={{ ...styles.th, cursor: 'pointer' }} onClick={() => handleSort('product_category')}>
                      Category {sortCol === 'product_category' && <span style={styles.sortArrow}>{sortDir === 'asc' ? '↑' : '↓'}</span>}
                    </th>
                    <th style={{ ...styles.th, textAlign: 'right', cursor: 'pointer' }} onClick={() => handleSort('net_amount_cents')}>
                      Amount {sortCol === 'net_amount_cents' && <span style={styles.sortArrow}>{sortDir === 'asc' ? '↑' : '↓'}</span>}
                    </th>
                    <th style={styles.th}>Platform</th>
                    <th style={styles.th}>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEvents.map((ev, i) => {
                    const cat = ev.product_category || 'other';
                    const catMeta = REVENUE_CATEGORIES[cat] || REVENUE_CATEGORIES.other;
                    const platform = ev.platform_accounts?.platform;
                    const platMeta = platform ? PLATFORM_META[platform] : null;
                    return (
                      <tr key={ev.id} style={i % 2 === 0 ? styles.trEven : {}}>
                        <td style={styles.td}>
                          {ev.occurred_at ? new Date(ev.occurred_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                        </td>
                        <td style={styles.td}>{ev.event_type}</td>
                        <td style={styles.td}>
                          <span style={{
                            display: 'inline-block', padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 600,
                            background: catMeta.color + '22', color: catMeta.color,
                          }}>
                            {catMeta.label}
                          </span>
                        </td>
                        <td style={{ ...styles.td, ...styles.tdValue, textAlign: 'right' }}>
                          ${(ev.net_amount_cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td style={styles.td}>
                          {platMeta ? (
                            <span style={{
                              display: 'inline-block', padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 600,
                              background: platMeta.color + '22', color: platMeta.color,
                            }}>
                              {platMeta.label}{ev.platform_accounts?.account_name ? ` · ${ev.platform_accounts.account_name}` : ''}
                            </span>
                          ) : <span style={{ color: 'rgba(255,255,255,0.3)' }}>—</span>}
                        </td>
                        <td style={{ ...styles.td, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {ev.description || '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={styles.emptyCard}>
              <p style={styles.emptyText}>No revenue events found for this period.</p>
            </div>
          )}
        </>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════
// Advanced View
// ═══════════════════════════════════════════════
function AdvancedView({ accounts }) {
  // ── Table filters ──
  const [tableSplit, setTableSplit] = useState('month');
  const [tableMetrics, setTableMetrics] = useState(['views', 'revenue']);
  const [contentTypeFilter, setContentTypeFilter] = useState('all');
  const [tableSelectedYears, setTableSelectedYears] = useState([new Date().getFullYear()]);
  const [tableDateMode, setTableDateMode] = useState('years'); // 'years' | 'custom'
  const [tableCustomStart, setTableCustomStart] = useState('');
  const [tableCustomEnd, setTableCustomEnd] = useState('');
  const [tableAccountIds, setTableAccountIds] = useState([]);
  const [tablePlatformOpen, setTablePlatformOpen] = useState(false);
  const tablePlatformRef = useRef(null);

  // ── Table data ──
  const [tableData, setTableData] = useState([]);
  const [tableLoading, setTableLoading] = useState(false);
  const [tableSortCol, setTableSortCol] = useState(null);
  const [tableSortDir, setTableSortDir] = useState('desc');
  const [metricDropdownOpen, setMetricDropdownOpen] = useState(false);
  const metricDropdownRef = useRef(null);

  // ── Comparison state ──
  const [compMetric, setCompMetric] = useState('views');
  const [compContentType, setCompContentType] = useState('all');
  const [compAccountIds, setCompAccountIds] = useState([]);
  const [compPlatformOpen, setCompPlatformOpen] = useState(false);
  const compPlatformRef = useRef(null);
  const [compPeriods, setCompPeriods] = useState([]);
  const [compData, setCompData] = useState([]);
  const [compLoading, setCompLoading] = useState(false);
  const [periodType, setPeriodType] = useState('in_season');
  const [periodYear, setPeriodYear] = useState(new Date().getFullYear());
  const [periodCustomStart, setPeriodCustomStart] = useState('');
  const [periodCustomEnd, setPeriodCustomEnd] = useState('');

  const allYears = useMemo(() => {
    const years = [];
    for (let y = new Date().getFullYear(); y >= 2020; y--) years.push(y);
    return years;
  }, []);

  // Compute effective date range from table year/custom selection
  const { tableStart, tableEnd } = useMemo(() => {
    if (tableDateMode === 'custom' && tableCustomStart && tableCustomEnd) {
      return { tableStart: tableCustomStart, tableEnd: tableCustomEnd };
    }
    if (tableSelectedYears.length === 0) {
      const y = new Date().getFullYear();
      return { tableStart: `${y}-01-01`, tableEnd: `${y}-12-31` };
    }
    const sorted = [...tableSelectedYears].sort();
    return { tableStart: `${sorted[0]}-01-01`, tableEnd: `${sorted[sorted.length - 1]}-12-31` };
  }, [tableDateMode, tableCustomStart, tableCustomEnd, tableSelectedYears]);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e) {
      if (metricDropdownRef.current && !metricDropdownRef.current.contains(e.target)) setMetricDropdownOpen(false);
      if (tablePlatformRef.current && !tablePlatformRef.current.contains(e.target)) setTablePlatformOpen(false);
      if (compPlatformRef.current && !compPlatformRef.current.contains(e.target)) setCompPlatformOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function toggleYear(y) {
    setTableSelectedYears(prev => prev.includes(y) ? prev.filter(v => v !== y) : [...prev, y]);
  }

  function toggleTableAccount(id) {
    setTableAccountIds(prev => prev.includes(id) ? prev.filter(v => v !== id) : [...prev, id]);
  }

  function toggleCompAccount(id) {
    setCompAccountIds(prev => prev.includes(id) ? prev.filter(v => v !== id) : [...prev, id]);
  }

  // Available metrics for current split
  const availableMetrics = useMemo(() => {
    if (tableSplit === 'content') return AVAILABLE_METRICS;
    return AVAILABLE_METRICS.filter(m => !m.contentOnly);
  }, [tableSplit]);

  // Effective account IDs for table (respects platform filter + content type)
  const effectiveTableAccountIds = useMemo(() => {
    return getContentTypeAccountIds(accounts, tableAccountIds, contentTypeFilter);
  }, [accounts, tableAccountIds, contentTypeFilter]);

  // ── Fetch table data ──
  useEffect(() => {
    fetchTableData();
  }, [tableSplit, contentTypeFilter, tableStart, tableEnd, effectiveTableAccountIds.join(','), tableMetrics.join(',')]);

  async function fetchTableData() {
    setTableLoading(true);
    try {
      if (tableSplit === 'content') await fetchContentSplit();
      else if (tableSplit.startsWith('bucket_')) await fetchBucketSplit();
      else await fetchDateSplit();
    } catch (err) {
      console.error('Table fetch error:', err);
      setTableData([]);
    }
    setTableLoading(false);
  }

  async function fetchContentSplit() {
    if (!effectiveTableAccountIds.length) { setTableData([]); return; }
    let q = supabase
      .from('content_items')
      .select(`*, platform_account:platform_accounts(platform, account_name), latest_metrics:content_metrics(views, likes, comments, shares, engagement_rate)`)
      .gte('published_at', tableStart)
      .lte('published_at', tableEnd)
      .in('platform_account_id', effectiveTableAccountIds)
      .order('published_at', { ascending: false })
      .limit(200);
    const { data } = await q;

    let rows = (data || []).map(item => {
      const metrics = item.latest_metrics?.[0] || {};
      return {
        label: item.title || '(Untitled)',
        sublabel: item.platform_account?.platform ? `${PLATFORM_META[item.platform_account.platform]?.label || item.platform_account.platform}${item.platform_account.account_name ? ' \u00b7 ' + item.platform_account.account_name : ''}` : '',
        platform: item.platform_account?.platform, url: item.url,
        content_views: Number(metrics.views) || 0, content_likes: Number(metrics.likes) || 0,
        content_comments: Number(metrics.comments) || 0, content_shares: Number(metrics.shares) || 0,
        content_engagement: Number(metrics.engagement_rate) || 0,
        _contentType: item.content_type,
        _duration: item.duration_seconds,
      };
    });

    if (contentTypeFilter === 'short') {
      // TikTok/IG/FB = all short form; YouTube = shorts only (content_type or duration < 60s)
      rows = rows.filter(r => {
        if (['tiktok', 'instagram', 'facebook'].includes(r.platform)) return true;
        if (r.platform === 'youtube') return r._contentType === 'short' || (r._duration != null && r._duration < 60);
        return false;
      });
    } else if (contentTypeFilter === 'long') {
      // YouTube long-form + Twitch VODs
      rows = rows.filter(r => {
        if (r.platform === 'youtube') return r._contentType === 'video' || r._contentType === 'live' || (r._duration != null && r._duration >= 60);
        if (r.platform === 'twitch') return true;
        return false;
      });
    }
    setTableData(rows);
  }

  async function fetchDateSplit() {
    if (!effectiveTableAccountIds.length) { setTableData([]); return; }
    const { data: rollups } = await supabase.from('daily_platform_rollups').select('*')
      .gte('date', tableStart).lte('date', tableEnd).in('platform_account_id', effectiveTableAccountIds).order('date', { ascending: true });
    const needsYT = tableMetrics.some(k => AVAILABLE_METRICS.find(m => m.key === k)?.table === 'analytics_youtube_daily');
    let ytData = [];
    if (needsYT) {
      const { data } = await supabase.from('analytics_youtube_daily').select('*').gte('date', tableStart).lte('date', tableEnd).order('date', { ascending: true });
      ytData = data || [];
    }
    const grouped = {};
    for (const row of (rollups || [])) {
      let key; if (tableSplit === 'day') key = row.date; else if (tableSplit === 'month') key = row.date.slice(0, 7); else key = row.date.slice(0, 4);
      if (!grouped[key]) grouped[key] = { rollups: [], yt: [] }; grouped[key].rollups.push(row);
    }
    for (const row of ytData) {
      let key; if (tableSplit === 'day') key = row.date; else if (tableSplit === 'month') key = row.date.slice(0, 7); else key = row.date.slice(0, 4);
      if (!grouped[key]) grouped[key] = { rollups: [], yt: [] }; grouped[key].yt.push(row);
    }
    const rows = Object.entries(grouped).map(([key, { rollups: rRows, yt: yRows }]) => {
      const row = { label: formatGroupLabel(key, tableSplit), _sortKey: key };
      for (const m of AVAILABLE_METRICS.filter(m => m.table === 'daily_platform_rollups' && !m.contentOnly)) {
        if (m.aggregate === 'avg') row[m.key] = rRows.length ? rRows.reduce((s, r) => s + m.getValue(r), 0) / rRows.length : 0;
        else if (m.aggregate === 'last') row[m.key] = rRows.length ? m.getValue(rRows[rRows.length - 1]) : 0;
        else row[m.key] = rRows.reduce((s, r) => s + m.getValue(r), 0);
      }
      for (const m of AVAILABLE_METRICS.filter(m => m.table === 'analytics_youtube_daily')) {
        if (m.aggregate === 'avg') row[m.key] = yRows.length ? yRows.reduce((s, r) => s + m.getValue(r), 0) / yRows.length : 0;
        else row[m.key] = yRows.reduce((s, r) => s + m.getValue(r), 0);
      }
      return row;
    }).sort((a, b) => a._sortKey.localeCompare(b._sortKey));
    setTableData(rows);
  }

  async function fetchBucketSplit() {
    const bucketKey = tableSplit.replace('bucket_', '');
    const years = getYearsInRange(tableStart, tableEnd);
    if (!effectiveTableAccountIds.length) { setTableData([]); return; }
    const { data: rollups } = await supabase.from('daily_platform_rollups').select('*')
      .gte('date', tableStart).lte('date', tableEnd).in('platform_account_id', effectiveTableAccountIds);
    const needsYT = tableMetrics.some(k => AVAILABLE_METRICS.find(m => m.key === k)?.table === 'analytics_youtube_daily');
    let ytData = [];
    if (needsYT) {
      const { data } = await supabase.from('analytics_youtube_daily').select('*').gte('date', tableStart).lte('date', tableEnd);
      ytData = data || [];
    }
    const rows = [];
    for (const year of years) {
      const range = getBucketDateRange(bucketKey, year);
      if (!range || range.end < tableStart || range.start > tableEnd) continue;
      const bucketRollups = (rollups || []).filter(r => r.date >= range.start && r.date < range.end);
      const bucketYt = ytData.filter(r => r.date >= range.start && r.date < range.end);
      const row = { label: range.label, _sortKey: `${year}` };
      for (const m of AVAILABLE_METRICS.filter(m => m.table === 'daily_platform_rollups' && !m.contentOnly)) {
        if (m.aggregate === 'avg') row[m.key] = bucketRollups.length ? bucketRollups.reduce((s, r) => s + m.getValue(r), 0) / bucketRollups.length : 0;
        else if (m.aggregate === 'last') row[m.key] = bucketRollups.length ? m.getValue(bucketRollups[bucketRollups.length - 1]) : 0;
        else row[m.key] = bucketRollups.reduce((s, r) => s + m.getValue(r), 0);
      }
      for (const m of AVAILABLE_METRICS.filter(m => m.table === 'analytics_youtube_daily')) {
        if (m.aggregate === 'avg') row[m.key] = bucketYt.length ? bucketYt.reduce((s, r) => s + m.getValue(r), 0) / bucketYt.length : 0;
        else row[m.key] = bucketYt.reduce((s, r) => s + m.getValue(r), 0);
      }
      rows.push(row);
    }
    setTableData(rows);
  }

  function formatGroupLabel(key, split) {
    if (split === 'day') return new Date(key + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    if (split === 'month') { const [y, m] = key.split('-'); return MONTHS[parseInt(m, 10) - 1] + ' ' + y; }
    return key;
  }

  const sortedTableData = useMemo(() => {
    if (!tableSortCol) return tableData;
    return [...tableData].sort((a, b) => {
      // For label column, sort by _sortKey (chronological) instead of formatted label (alphabetical)
      const va = tableSortCol === 'label' ? (a._sortKey ?? '') : (a[tableSortCol] ?? 0);
      const vb = tableSortCol === 'label' ? (b._sortKey ?? '') : (b[tableSortCol] ?? 0);
      if (typeof va === 'string') return tableSortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      return tableSortDir === 'asc' ? va - vb : vb - va;
    });
  }, [tableData, tableSortCol, tableSortDir]);

  function handleTableSort(col) {
    if (tableSortCol === col) setTableSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setTableSortCol(col); setTableSortDir('desc'); }
  }

  function toggleMetric(key) {
    setTableMetrics(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  }

  // ── Comparison ──
  function addPeriod() {
    let pStart, pEnd, label;
    if (periodType === 'custom') {
      if (!periodCustomStart || !periodCustomEnd) return;
      pStart = periodCustomStart; pEnd = periodCustomEnd; label = `${pStart} to ${pEnd}`;
    } else {
      const range = getBucketDateRange(periodType, periodYear);
      if (!range) return;
      pStart = range.start; pEnd = range.end; label = range.label;
    }
    const color = LINE_COLORS[compPeriods.length % LINE_COLORS.length];
    setCompPeriods(prev => [...prev, { start: pStart, end: pEnd, label, color }]);
  }

  function removePeriod(idx) {
    setCompPeriods(prev => prev.filter((_, i) => i !== idx));
  }

  // Effective comparison account IDs
  const effectiveCompAccountIds = useMemo(() => {
    return getContentTypeAccountIds(accounts, compAccountIds, compContentType);
  }, [accounts, compAccountIds, compContentType]);

  useEffect(() => {
    if (compPeriods.length === 0) { setCompData([]); return; }
    fetchComparisonData();
  }, [compPeriods, compMetric, effectiveCompAccountIds.join(',')]);

  async function fetchComparisonData() {
    setCompLoading(true);
    try {
      const metricDef = AVAILABLE_METRICS.find(m => m.key === compMetric);
      if (!metricDef) { setCompData([]); setCompLoading(false); return; }
      const results = await Promise.all(compPeriods.map(async (period) => {
        let values = [];
        if (metricDef.table === 'daily_platform_rollups') {
          let q = supabase.from('daily_platform_rollups').select('*').gte('date', period.start).lt('date', period.end).order('date', { ascending: true });
          if (effectiveCompAccountIds.length) q = q.in('platform_account_id', effectiveCompAccountIds);
          const { data } = await q;
          const byDate = {};
          for (const row of (data || [])) { if (!byDate[row.date]) byDate[row.date] = []; byDate[row.date].push(row); }
          values = Object.keys(byDate).sort().map((d, i) => {
            const rows = byDate[d];
            const val = metricDef.aggregate === 'avg' ? rows.reduce((s, r) => s + metricDef.getValue(r), 0) / rows.length : rows.reduce((s, r) => s + metricDef.getValue(r), 0);
            return { dayIndex: i, date: d, value: val };
          });
        } else if (metricDef.table === 'analytics_youtube_daily') {
          const { data } = await supabase.from('analytics_youtube_daily').select('*').gte('date', period.start).lt('date', period.end).order('date', { ascending: true });
          const byDate = {};
          for (const row of (data || [])) { if (!byDate[row.date]) byDate[row.date] = []; byDate[row.date].push(row); }
          values = Object.keys(byDate).sort().map((d, i) => {
            const rows = byDate[d];
            const val = metricDef.aggregate === 'avg' ? rows.reduce((s, r) => s + metricDef.getValue(r), 0) / rows.length : rows.reduce((s, r) => s + metricDef.getValue(r), 0);
            return { dayIndex: i, date: d, value: val };
          });
        }
        return { ...period, values };
      }));
      setCompData(results);
    } catch (err) { console.error('Comparison fetch error:', err); }
    setCompLoading(false);
  }

  // Split comparison metrics into groups
  const compRollupMetrics = COMPARISON_METRICS.filter(m => m.table === 'daily_platform_rollups');
  const compYouTubeMetrics = COMPARISON_METRICS.filter(m => m.table === 'analytics_youtube_daily');

  // Platform dropdown renderer (reused for table & comparison)
  function renderPlatformDropdown(open, setOpen, ref, selectedIds, toggleFn) {
    return (
      <div ref={ref} style={{ position: 'relative' }}>
        <button onClick={() => setOpen(!open)}
          style={{ ...styles.filterChip, display: 'flex', alignItems: 'center', gap: '6px' }}>
          Platforms
          {selectedIds.length > 0 && (
            <span style={{ background: 'rgba(99,102,241,0.3)', padding: '1px 6px', borderRadius: '8px', fontSize: '10px', fontWeight: 700, color: '#a5b4fc' }}>
              {selectedIds.length}
            </span>
          )}
          <span style={{ fontSize: '10px', marginLeft: '2px' }}>{open ? '\u25B2' : '\u25BC'}</span>
        </button>
        {open && (
          <div style={{ ...styles.platformDropdown, zIndex: 60 }}>
            {selectedIds.length > 0 && (
              <button onClick={() => { toggleFn('__clear__'); }} style={styles.platformDropdownClear}>Clear all</button>
            )}
            {accounts.map(acct => {
              const meta = PLATFORM_META[acct.platform] || { label: acct.platform, color: '#666', icon: '?' };
              const isActive = selectedIds.length === 0 || selectedIds.includes(acct.id);
              return (
                <button key={acct.id} onClick={() => toggleFn(acct.id)}
                  style={{ ...styles.platformDropdownItem, ...(isActive ? { background: meta.color + '18', borderColor: meta.color + '55', color: meta.color } : {}) }}>
                  <span style={{ ...styles.platformDot, background: meta.color, opacity: isActive ? 1 : 0.35 }} />
                  <span style={{ flex: 1 }}>{acct.account_name}</span>
                  {selectedIds.includes(acct.id) && <span style={{ fontSize: '12px', color: meta.color }}>{'\u2713'}</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  function handleTablePlatformToggle(id) {
    if (id === '__clear__') setTableAccountIds([]);
    else toggleTableAccount(id);
  }

  function handleCompPlatformToggle(id) {
    if (id === '__clear__') setCompAccountIds([]);
    else toggleCompAccount(id);
  }

  return (
    <div>
      {/* ══ Custom Table Section ══ */}
      <div style={styles.chartSection}>
        <span style={styles.chartTitle}>Custom Table</span>

        {/* Row 1: Date range */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginTop: '12px' }}>
          <button onClick={() => setTableDateMode('years')}
            style={{ ...styles.filterChip, ...(tableDateMode === 'years' ? styles.filterChipActive : {}) }}>Years</button>
          <button onClick={() => setTableDateMode('custom')}
            style={{ ...styles.filterChip, ...(tableDateMode === 'custom' ? styles.filterChipActive : {}) }}>Custom Range</button>
          {tableDateMode === 'years' ? (
            allYears.map(y => (
              <button key={y} onClick={() => toggleYear(y)}
                style={{ ...styles.filterChip, ...(tableSelectedYears.includes(y) ? styles.filterChipActive : {}), minWidth: '48px', textAlign: 'center' }}>
                {y}
              </button>
            ))
          ) : (
            <>
              <input type="date" value={tableCustomStart} onChange={e => setTableCustomStart(e.target.value)} style={styles.filterInput} />
              <span style={{ color: 'rgba(255,255,255,0.3)' }}>to</span>
              <input type="date" value={tableCustomEnd} onChange={e => setTableCustomEnd(e.target.value)} style={styles.filterInput} />
            </>
          )}
        </div>

        {/* Row 2: Split, platform, content type, columns */}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginTop: '10px', marginBottom: '16px' }}>
          <select value={tableSplit} onChange={e => {
            setTableSplit(e.target.value);
            setTableMetrics(prev => prev.filter(k => { const m = AVAILABLE_METRICS.find(am => am.key === k); return !m?.contentOnly || e.target.value === 'content'; }));
          }} style={styles.filterSelect}>
            {ROW_SPLITS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>

          {renderPlatformDropdown(tablePlatformOpen, setTablePlatformOpen, tablePlatformRef, tableAccountIds, handleTablePlatformToggle)}

          {['all', 'short', 'long'].map(ct => (
            <button key={ct} onClick={() => setContentTypeFilter(ct)}
              style={{ ...styles.filterChip, ...(contentTypeFilter === ct ? styles.filterChipActive : {}) }}>
              {ct === 'all' ? 'All' : ct === 'short' ? 'Short Form' : 'Long Form'}
            </button>
          ))}

          {/* Metric column picker */}
          <div ref={metricDropdownRef} style={{ position: 'relative' }}>
            <button onClick={() => setMetricDropdownOpen(!metricDropdownOpen)}
              style={{ ...styles.filterChip, display: 'flex', alignItems: 'center', gap: '6px' }}>
              Columns
              <span style={{ background: 'rgba(99,102,241,0.3)', padding: '1px 6px', borderRadius: '8px', fontSize: '10px', fontWeight: 700, color: '#a5b4fc' }}>{tableMetrics.length}</span>
              <span style={{ fontSize: '10px', marginLeft: '2px' }}>{metricDropdownOpen ? '\u25B2' : '\u25BC'}</span>
            </button>
            {metricDropdownOpen && (
              <div style={{ ...styles.platformDropdown, minWidth: '240px', maxHeight: '320px', overflow: 'auto' }}>
                {['Platform Rollups', 'Content Metrics', 'YouTube'].map(group => {
                  const groupMetrics = availableMetrics.filter(m => m.group === group);
                  if (!groupMetrics.length) return null;
                  return (
                    <div key={group}>
                      <div style={{ padding: '6px 12px', fontSize: '10px', fontWeight: 700, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{group}</div>
                      {groupMetrics.map(m => (
                        <button key={m.key} onClick={() => toggleMetric(m.key)}
                          style={{ ...styles.platformDropdownItem, ...(tableMetrics.includes(m.key) ? { background: 'rgba(99,102,241,0.12)', color: '#a5b4fc' } : {}) }}>
                          <span style={{ width: '14px', textAlign: 'center', fontSize: '11px' }}>{tableMetrics.includes(m.key) ? '\u2713' : ''}</span>
                          <span>{m.label}</span>
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Table */}
        {tableLoading ? (
          <p style={styles.emptyText}>Loading...</p>
        ) : sortedTableData.length === 0 ? (
          <p style={styles.emptyText}>No data for selected filters</p>
        ) : (
          <div style={{ ...styles.tableWrap, marginBottom: 0 }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={{ ...styles.th, ...styles.thSticky, cursor: 'pointer' }} onClick={() => handleTableSort('label')}>
                    {tableSplit === 'content' ? 'Content' : 'Period'}
                    {tableSortCol === 'label' && <span style={styles.sortArrow}>{tableSortDir === 'asc' ? '\u2191' : '\u2193'}</span>}
                  </th>
                  {tableMetrics.map(key => {
                    const m = AVAILABLE_METRICS.find(am => am.key === key);
                    if (!m) return null;
                    return (
                      <th key={key} style={{ ...styles.th, textAlign: 'right', cursor: 'pointer' }} onClick={() => handleTableSort(key)}>
                        {m.label}
                        {tableSortCol === key && <span style={styles.sortArrow}>{tableSortDir === 'asc' ? '\u2191' : '\u2193'}</span>}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sortedTableData.map((row, i) => (
                  <tr key={i} style={i % 2 === 0 ? styles.trEven : {}}>
                    <td style={{ ...styles.td, ...styles.tdSticky, background: i % 2 === 0 ? 'rgba(255,255,255,0.01)' : '#12121f' }}>
                      {row.url ? (
                        <a href={row.url} target="_blank" rel="noopener noreferrer" style={{ color: '#e2e8f0', textDecoration: 'none', fontWeight: 500 }}>{row.label}</a>
                      ) : (
                        <span style={{ fontWeight: 500, color: '#e2e8f0' }}>{row.label}</span>
                      )}
                      {row.sublabel && <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', marginTop: '2px' }}>{row.sublabel}</div>}
                    </td>
                    {tableMetrics.map(key => {
                      const m = AVAILABLE_METRICS.find(am => am.key === key);
                      if (!m) return <td key={key} style={styles.td}>{'\u2014'}</td>;
                      const val = row[key];
                      return <td key={key} style={{ ...styles.td, ...styles.tdValue, textAlign: 'right' }}>{val != null ? m.format(val) : '\u2014'}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ══ Compare Periods Section ══ */}
      <div style={styles.chartSection}>
        <span style={styles.chartTitle}>Compare Periods</span>

        {/* Row 1: Metric (split by source), content type, platform */}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginTop: '12px', marginBottom: '10px' }}>
          <select value={compMetric} onChange={e => setCompMetric(e.target.value)} style={styles.filterSelect}>
            <optgroup label="Platform Rollups">
              {compRollupMetrics.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
            </optgroup>
            <optgroup label="YouTube">
              {compYouTubeMetrics.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
            </optgroup>
          </select>

          {renderPlatformDropdown(compPlatformOpen, setCompPlatformOpen, compPlatformRef, compAccountIds, handleCompPlatformToggle)}

          {['all', 'short', 'long'].map(ct => (
            <button key={ct} onClick={() => setCompContentType(ct)}
              style={{ ...styles.filterChip, ...(compContentType === ct ? styles.filterChipActive : {}) }}>
              {ct === 'all' ? 'All' : ct === 'short' ? 'Short Form' : 'Long Form'}
            </button>
          ))}
        </div>

        {/* Row 2: Period builder (bucket/year + custom) */}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '12px' }}>
          <select value={periodType} onChange={e => setPeriodType(e.target.value)} style={styles.filterSelect}>
            <option value="custom">Custom Range</option>
            {Object.entries(BUCKET_DEFS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>

          {periodType !== 'custom' ? (
            <select value={periodYear} onChange={e => setPeriodYear(Number(e.target.value))} style={styles.filterSelect}>
              {allYears.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          ) : (
            <>
              <input type="date" value={periodCustomStart} onChange={e => setPeriodCustomStart(e.target.value)} style={styles.filterInput} />
              <span style={{ color: 'rgba(255,255,255,0.3)' }}>to</span>
              <input type="date" value={periodCustomEnd} onChange={e => setPeriodCustomEnd(e.target.value)} style={styles.filterInput} />
            </>
          )}

          <button onClick={addPeriod}
            style={{ ...styles.filterChip, background: 'rgba(99,102,241,0.15)', borderColor: 'rgba(99,102,241,0.4)', color: '#a5b4fc' }}>
            + Add Period
          </button>
        </div>

        {/* Active periods as chips */}
        {compPeriods.length > 0 && (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
            {compPeriods.map((p, i) => (
              <span key={i} style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 12px',
                borderRadius: '14px', fontSize: '12px', fontWeight: 600,
                background: p.color + '18', border: `1px solid ${p.color}44`, color: p.color,
              }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: p.color }} />
                {p.label}
                <button onClick={() => removePeriod(i)}
                  style={{ background: 'none', border: 'none', color: p.color, cursor: 'pointer', fontSize: '14px', padding: '0 2px', fontFamily: 'inherit', lineHeight: 1, opacity: 0.7 }}>
                  {'\u00d7'}
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Chart */}
        {compLoading ? (
          <p style={styles.emptyText}>Loading comparison...</p>
        ) : compData.length > 0 ? (
          <ComparisonChart data={compData} metricDef={AVAILABLE_METRICS.find(m => m.key === compMetric)} />
        ) : (
          <p style={styles.emptyText}>Add periods above to compare</p>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// Comparison Chart (SVG overlay)
// ═══════════════════════════════════════════════
function ComparisonChart({ data, metricDef }) {
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const W = 900, H = 300, PAD = { top: 20, right: 20, bottom: 40, left: 70 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  if (!data.length || !data.some(d => d.values.length > 0)) return null;

  const maxDays = Math.max(...data.map(d => d.values.length));
  if (maxDays === 0) return null;

  const xStep = plotW / Math.max(maxDays - 1, 1);

  // Shared Y-axis scale
  const allValues = data.flatMap(d => d.values.map(v => v.value));
  const maxVal = Math.max(...allValues, 1);
  const minVal = Math.min(...allValues, 0);
  const range = maxVal - minVal || 1;

  // Build paths per series
  const series = data.map(d => {
    const points = d.values.map((v, i) => ({
      x: PAD.left + i * xStep,
      y: PAD.top + plotH - ((v.value - minVal) / range) * plotH,
    }));
    const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    return { ...d, points, path };
  });

  // Y-axis labels
  const gridLines = 4;
  const yLabels = Array.from({ length: gridLines + 1 }, (_, i) => {
    const val = minVal + (range / gridLines) * i;
    return { y: PAD.top + plotH - (plotH / gridLines) * i, label: metricDef ? metricDef.format(val) : formatCompact(val) };
  });

  // X-axis labels
  const tickCount = Math.min(maxDays, 10);
  const tickInterval = Math.max(1, Math.floor((maxDays - 1) / (tickCount - 1)));

  return (
    <div style={{ overflowX: 'auto', position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxHeight: '320px' }}
        onMouseLeave={() => setHoveredIndex(null)}>
        {/* Grid lines + Y labels */}
        {yLabels.map((yl, i) => (
          <g key={i}>
            <line x1={PAD.left} y1={yl.y} x2={W - PAD.right} y2={yl.y} stroke="rgba(255,255,255,0.05)" />
            <text x={PAD.left - 8} y={yl.y + 4} fill="rgba(255,255,255,0.3)" fontSize="9" textAnchor="end">{yl.label}</text>
          </g>
        ))}
        {/* X-axis labels */}
        {Array.from({ length: maxDays }, (_, i) => {
          if (maxDays > 10 && i !== 0 && i !== maxDays - 1 && i % tickInterval !== 0) return null;
          // Show date from the longest series if available
          const longestSeries = series.reduce((a, b) => a.values.length >= b.values.length ? a : b, series[0]);
          const dateStr = longestSeries?.values[i]?.date;
          let label = `Day ${i}`;
          if (dateStr) {
            const d = toLocalDate(dateStr);
            label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          }
          return (
            <text key={i} x={PAD.left + i * xStep} y={H - 8} fill="rgba(255,255,255,0.3)" fontSize="10" textAnchor="middle">
              {label}
            </text>
          );
        })}
        {/* Lines */}
        {series.map((s, si) => (
          <path key={si} d={s.path} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round"
            opacity={hoveredIndex !== null ? 0.6 : 1} />
        ))}
        {/* Hover guide line */}
        {hoveredIndex !== null && (
          <line
            x1={PAD.left + hoveredIndex * xStep} y1={PAD.top}
            x2={PAD.left + hoveredIndex * xStep} y2={PAD.top + plotH}
            stroke="rgba(255,255,255,0.2)" strokeWidth="1" strokeDasharray="4,3"
          />
        )}
        {/* Hover dots */}
        {hoveredIndex !== null && series.map((s, si) => {
          if (!s.points[hoveredIndex]) return null;
          return (
            <circle key={si} cx={s.points[hoveredIndex].x} cy={s.points[hoveredIndex].y}
              r="4" fill={s.color} stroke="#12121f" strokeWidth="1.5" />
          );
        })}
        {/* Invisible hover rects */}
        {Array.from({ length: maxDays }, (_, i) => (
          <rect key={i} x={Math.max(PAD.left + i * xStep - xStep / 2, 0)} y={PAD.top}
            width={xStep} height={plotH} fill="transparent"
            onMouseEnter={() => setHoveredIndex(i)} />
        ))}
      </svg>
      {/* Tooltip */}
      {hoveredIndex !== null && (
        <div style={{
          position: 'absolute', top: '8px',
          left: `${((PAD.left + hoveredIndex * xStep) / W) * 100}%`,
          transform: hoveredIndex > maxDays * 0.7 ? 'translateX(-110%)' : 'translateX(10px)',
          background: 'rgba(18,18,31,0.95)', border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: '8px', padding: '10px 14px', zIndex: 10, pointerEvents: 'none',
          minWidth: '160px', boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        }}>
          {series.map((s, si) => {
            const val = s.values[hoveredIndex];
            const dateStr = val?.date;
            const dateLabel = dateStr ? toLocalDate(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
            return (
              <div key={si} style={{ marginBottom: si < series.length - 1 ? '6px' : 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                  <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>{s.label}</span>
                  <span style={{ fontSize: '12px', color: '#fff', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                    {val ? (metricDef ? metricDef.format(val.value) : formatCompact(val.value)) : '\u2014'}
                  </span>
                </div>
                {dateLabel && <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.3)', marginLeft: '12px', marginTop: '1px' }}>{dateLabel}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
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
// Trend Chart (SVG multi-metric line graph)
// ═══════════════════════════════════════════════
function TrendChart({ data, metrics }) {
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const W = 900, H = 280, PAD = { top: 20, right: 20, bottom: 40, left: 20 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  if (!data.length) return null;

  const xStep = plotW / Math.max(data.length - 1, 1);

  // Compute per-metric max and build paths
  const metricLines = metrics.map(m => {
    const values = data.map(d => m.getValue(d));
    const maxVal = Math.max(...values, 1);
    const points = data.map((d, i) => {
      const x = PAD.left + i * xStep;
      const y = PAD.top + plotH - ((m.getValue(d) / maxVal) * plotH);
      return { x, y };
    });
    const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const areaPath = path + ` L${points[points.length - 1].x.toFixed(1)},${PAD.top + plotH} L${PAD.left},${PAD.top + plotH} Z`;
    return { ...m, values, maxVal, points, path, areaPath };
  });

  // Dynamic x-axis date formatting
  const totalDays = data.length > 1
    ? Math.ceil((toLocalDate(data[data.length - 1].date) - toLocalDate(data[0].date)) / 86400000)
    : 1;
  function formatDateLabel(dateStr) {
    const d = toLocalDate(dateStr);
    if (totalDays <= 31) {
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    const yr = String(d.getFullYear()).slice(2);
    return d.toLocaleDateString('en-US', { month: 'short' }) + " '" + yr;
  }

  const tickCount = Math.min(data.length, 8);
  const tickInterval = Math.max(1, Math.floor((data.length - 1) / (tickCount - 1)));

  // Grid lines
  const gridLines = 4;
  const gridYs = Array.from({ length: gridLines + 1 }, (_, i) => PAD.top + plotH - (plotH / gridLines) * i);

  // Tooltip formatter
  function formatMetricValue(m, val) {
    if (m.formatValue) return m.formatValue(val);
    if (m.key === 'revenue') return '$' + val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (m.key === 'engagement') return val.toFixed(2) + '%';
    return formatCompact(val);
  }

  return (
    <div style={{ overflowX: 'auto', position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxHeight: '300px' }}
        onMouseLeave={() => setHoveredIndex(null)}>
        {/* Grid lines */}
        {gridYs.map((y, i) => (
          <line key={i} x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="rgba(255,255,255,0.05)" />
        ))}
        {/* X-axis labels */}
        {data.map((d, i) => {
          if (data.length <= 8) { /* show all */ }
          else if (i !== 0 && i !== data.length - 1 && i % tickInterval !== 0) return null;
          const x = PAD.left + i * xStep;
          return (
            <text key={i} x={x} y={H - 8} fill="rgba(255,255,255,0.3)" fontSize="10" textAnchor="middle">
              {formatDateLabel(d.date)}
            </text>
          );
        })}
        {/* Area fills and lines for each metric */}
        {metricLines.map(m => (
          <g key={m.key}>
            <path d={m.areaPath} fill={m.color + '10'} />
            <path d={m.path} fill="none" stroke={m.color} strokeWidth="1.5" strokeLinejoin="round" opacity={hoveredIndex !== null ? 0.7 : 1} />
          </g>
        ))}
        {/* Hover guide line */}
        {hoveredIndex !== null && (
          <line
            x1={PAD.left + hoveredIndex * xStep} y1={PAD.top}
            x2={PAD.left + hoveredIndex * xStep} y2={PAD.top + plotH}
            stroke="rgba(255,255,255,0.2)" strokeWidth="1" strokeDasharray="4,3"
          />
        )}
        {/* Hover dots */}
        {hoveredIndex !== null && metricLines.map(m => (
          <circle key={m.key} cx={m.points[hoveredIndex].x} cy={m.points[hoveredIndex].y}
            r="3.5" fill={m.color} stroke="#12121f" strokeWidth="1.5" />
        ))}
        {/* Invisible hover rects */}
        {data.map((d, i) => {
          const x = PAD.left + i * xStep - xStep / 2;
          return (
            <rect key={i} x={Math.max(x, 0)} y={PAD.top} width={xStep} height={plotH}
              fill="transparent" onMouseEnter={() => setHoveredIndex(i)} />
          );
        })}
      </svg>
      {/* Tooltip */}
      {hoveredIndex !== null && (
        <div style={{
          position: 'absolute',
          top: '8px',
          left: `${((PAD.left + hoveredIndex * xStep) / W) * 100}%`,
          transform: hoveredIndex > data.length * 0.7 ? 'translateX(-110%)' : 'translateX(10px)',
          background: 'rgba(18,18,31,0.95)', border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: '8px', padding: '10px 14px', zIndex: 10, pointerEvents: 'none',
          minWidth: '140px', boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        }}>
          <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '6px', fontWeight: 600 }}>
            {toLocalDate(data[hoveredIndex].date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </div>
          {metricLines.map(m => (
            <div key={m.key} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: m.color, flexShrink: 0 }} />
              <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', minWidth: '70px' }}>{m.label}</span>
              <span style={{ fontSize: '12px', color: '#fff', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                {formatMetricValue(m, m.values[hoveredIndex])}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════
// Donut Chart (SVG)
// ═══════════════════════════════════════════════
function DonutChart({ data, valueKey = 'views', centerLabel = 'total views', formatValue }) {
  const size = 160;
  const cx = size / 2, cy = size / 2;
  const outerR = 70, innerR = 45;
  const total = data.reduce((s, d) => s + (d[valueKey] || 0), 0);
  if (total === 0) return null;

  let cumAngle = -Math.PI / 2;
  const segments = data.map(d => {
    const val = d[valueKey] || 0;
    const angle = (val / total) * 2 * Math.PI;
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

  const centerText = formatValue ? formatValue(total) : formatCompact(total);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {segments.map((s, i) => (
        <path key={i} d={s.path} fill={s.color} stroke="#12121f" strokeWidth="1" />
      ))}
      <text x={cx} y={cy - 6} textAnchor="middle" fill="#fff" fontSize="16" fontWeight="700">{centerText}</text>
      <text x={cx} y={cy + 12} textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="10">{centerLabel}</text>
    </svg>
  );
}

// ═══════════════════════════════════════════════
// Ingestion Health Panel (Admin)
// ═══════════════════════════════════════════════
function IngestionHealthPanel({ logs, accounts, onRefresh }) {
  const [expandedLogId, setExpandedLogId] = useState(null);
  const [revenueInput, setRevenueInput] = useState('');
  const [revenueSaving, setRevenueSaving] = useState(false);
  const [revenueResult, setRevenueResult] = useState(null);

  const accountMap = {};
  accounts.forEach(a => { accountMap[a.id] = a; });

  const statusColors = {
    running: '#f59e0b',
    success: '#4ade80',
    failed: '#f87171',
    partial: '#fb923c',
  };

  const canAddRevenue = (log) =>
    log.job_type === 'manual_csv_upload_tiktok' &&
    log.status === 'success' &&
    log.metadata?.date_start;

  async function handleSaveRevenue(log) {
    const totalCents = Math.round(parseFloat(revenueInput) * 100);
    if (!totalCents || totalCents <= 0) return;
    setRevenueSaving(true);
    setRevenueResult(null);
    try {
      const days = getDaysInRange(log.metadata.date_start, log.metadata.date_end);
      const numDays = days.length;
      const perDay = Math.floor(totalCents / numDays);
      const remainder = totalCents - perDay * numDays;
      const rows = days.map((d, i) => ({
        stripe_event_id: `manual_tiktok_${log.platform_account_id}_${d}`,
        event_type: 'charge',
        amount_cents: perDay + (i === numDays - 1 ? remainder : 0),
        net_amount_cents: perDay + (i === numDays - 1 ? remainder : 0),
        currency: 'usd',
        product_category: 'ad_revenue',
        is_recurring: false,
        occurred_at: `${d}T00:00:00Z`,
        metadata: { source: 'manual_input', platform: 'tiktok' },
        platform_account_id: log.platform_account_id,
      }));
      for (let i = 0; i < rows.length; i += 100) {
        const batch = rows.slice(i, i + 100);
        const { error } = await supabase.from('revenue_events')
          .upsert(batch, { onConflict: 'stripe_event_id' });
        if (error) throw new Error(error.message);
      }
      setRevenueResult({ success: true, count: rows.length });
      setRevenueInput('');
      if (onRefresh) onRefresh();
    } catch (err) {
      setRevenueResult({ error: err.message });
    }
    setRevenueSaving(false);
  }

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
            <th style={styles.th}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log, i) => {
            const acct = accountMap[log.platform_account_id];
            const duration = log.completed_at && log.started_at
              ? Math.round((new Date(log.completed_at) - new Date(log.started_at)) / 1000) + 's'
              : '...';
            const isExpanded = expandedLogId === log.id;
            return (
              <React.Fragment key={log.id}>
                <tr style={i % 2 === 0 ? styles.trEven : {}}>
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
                    {log.started_at ? new Date(log.started_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                  </td>
                  <td style={styles.td}>{duration}</td>
                  <td style={{ ...styles.td, color: '#f87171', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {log.error_message || '—'}
                  </td>
                  <td style={styles.td}>
                    {canAddRevenue(log) ? (
                      <button
                        onClick={() => { setExpandedLogId(isExpanded ? null : log.id); setRevenueInput(''); setRevenueResult(null); }}
                        style={{ background: 'none', border: '1px solid rgba(245,158,11,0.4)', borderRadius: '4px', color: '#f59e0b', cursor: 'pointer', padding: '2px 8px', fontSize: '13px', fontWeight: 700 }}
                        title="Add revenue for this upload's date range"
                      >$</button>
                    ) : '—'}
                  </td>
                </tr>
                {isExpanded && (
                  <tr style={{ background: 'rgba(245,158,11,0.05)' }}>
                    <td colSpan={8} style={{ padding: '8px 12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>
                          Date range: <strong style={{ color: '#fff' }}>{log.metadata.date_start}</strong> to <strong style={{ color: '#fff' }}>{log.metadata.date_end}</strong>
                        </span>
                        <input
                          type="number" step="0.01" min="0" placeholder="Revenue ($)"
                          value={revenueInput} onChange={e => setRevenueInput(e.target.value)}
                          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#fff', padding: '6px 10px', fontSize: '13px', width: '130px' }}
                        />
                        <button onClick={() => handleSaveRevenue(log)} disabled={revenueSaving || !revenueInput}
                          style={{ ...styles.uploadBtn, borderColor: '#f59e0b66', color: '#f59e0b', padding: '6px 14px', fontSize: '12px', opacity: revenueSaving || !revenueInput ? 0.5 : 1 }}>
                          {revenueSaving ? 'Saving...' : 'Save Revenue'}
                        </button>
                        {revenueResult && (
                          <span style={{ fontSize: '12px', color: revenueResult.error ? '#f87171' : '#4ade80' }}>
                            {revenueResult.error ? `Error: ${revenueResult.error}` : `Saved across ${revenueResult.count} days`}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
          {logs.length === 0 && (
            <tr><td colSpan={8} style={{ ...styles.td, textAlign: 'center', color: 'rgba(255,255,255,0.3)' }}>No ingestion logs yet</td></tr>
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
      {activeTab === 'tiktok' && (
        <div>
          <TikTokCSVUpload profile={profile} accounts={accounts} />
          <div style={{ marginTop: '16px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '12px' }}>
            <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Manual Input</span>
            <ManualMetricsForm platform="tiktok" fields={['followers']} accounts={accounts} />
          </div>
        </div>
      )}
      {activeTab === 'instagram' && <ManualMetricsForm platform="instagram" fields={['views', 'followers']} accounts={accounts} />}
      {activeTab === 'facebook' && <ManualMetricsForm platform="facebook" fields={['views', 'revenue', 'followers']} accounts={accounts} />}
      {activeTab === 'substack' && <ManualMetricsForm platform="substack" fields={['views', 'revenue', 'supporters', 'followers']} accounts={accounts} />}
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
  const [csvYear, setCsvYear] = useState(new Date().getFullYear());
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
        const date = parseDate(row['Date'] || row['date'] || row['DATE'], csvYear);
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

      const sortedDates = rows.map(r => r.date).sort();
      if (logEntry?.id) await supabase.from('ingestion_logs').update({
        status: 'success', records_processed: rows.length, records_created: inserted, completed_at: new Date().toISOString(),
        metadata: { date_start: sortedDates[0], date_end: sortedDates[sortedDates.length - 1] },
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
        Upload a CSV exported from TikTok Studio. Select the year for the data (TikTok CSVs don't include the year).
      </p>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>Year</label>
          <select value={csvYear} onChange={e => setCsvYear(Number(e.target.value))} style={{ ...styles.filterSelect, padding: '8px 10px' }}>
            {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
          style={{ ...styles.uploadBtn, borderColor: color + '66', color, alignSelf: 'flex-end' }}>
          {uploading ? 'Uploading...' : 'Upload TikTok CSV'}
        </button>
        <input ref={fileInputRef} type="file" accept=".csv" onChange={handleUpload} style={{ display: 'none' }} />
        {uploadResult && (
          <span style={{ fontSize: '12px', fontWeight: 500, color: uploadResult.error ? '#f87171' : '#4ade80', alignSelf: 'flex-end' }}>
            {uploadResult.error ? `Error: ${uploadResult.error}` : `${uploadResult.count} rows imported`}
          </span>
        )}
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
  const [followers, setFollowers] = useState('');
  const [supporters, setSupporters] = useState('');
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
  const hasFollowers = fields.includes('followers');
  const hasSupporters = fields.includes('supporters');

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
        .select('id, date, followers_total, metadata')
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
        byDate[row.date] = { ...byDate[row.date], date: row.date, aud_id: row.id, followers_total: row.followers_total, supporters: row.metadata?.supporters };
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
      if (hasSubscribers || hasFollowers || hasSupporters) {
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
    let logEntry = null;

    try {
      // Create ingestion log entry
      const { data: logData } = await supabase.from('ingestion_logs')
        .insert({ platform_account_id: account.id, job_type: `manual_input_${platform}`, status: 'running' })
        .select().single();
      logEntry = logData;

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

      // Followers / Supporters: audience_snapshots (snapshot, not split)
      const hasFollowersVal = hasFollowers && followers;
      const hasSupportersVal = hasSupporters && supporters;
      if (hasFollowersVal || hasSupportersVal) {
        const folNum = parseInt(followers, 10) || 0;
        const supNum = parseInt(supporters, 10) || 0;
        const rows = days.map(d => {
          const row = {
            platform_account_id: account.id,
            date: d,
            followers_gained: 0,
            demographics: {},
            metadata: { source: 'manual_input' },
          };
          if (hasFollowersVal) row.followers_total = folNum;
          if (hasSupportersVal) row.metadata.supporters = supNum;
          return row;
        });
        for (let i = 0; i < rows.length; i += 100) {
          const batch = rows.slice(i, i + 100);
          const { error } = await supabase.from('audience_snapshots')
            .upsert(batch, { onConflict: 'platform_account_id,date' });
          if (error) throw new Error(`Audience: ${error.message}`);
        }
        recordsProcessed += rows.length;
      }

      setResult({ success: true, days: numDays });
      setViews(''); setRevenue(''); setSubscribers(''); setFollowers(''); setSupporters('');

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
          Enter totals for the date range. Views and revenue are split evenly across days. Followers{hasSupporters ? ' and supporters are' : ' is'} set as a snapshot for each day.
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
          {hasSupporters && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>Supporters</label>
              <input type="text" inputMode="numeric" pattern="[0-9]*" value={supporters}
                onChange={e => setSupporters(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="0" style={{ ...styles.filterInput, padding: '8px 10px', width: '120px' }} />
            </div>
          )}
          {hasFollowers && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>{platform === 'substack' ? 'Subscribers' : 'Followers'}</label>
              <input type="text" inputMode="numeric" pattern="[0-9]*" value={followers}
                onChange={e => setFollowers(e.target.value.replace(/[^0-9]/g, ''))}
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
                      {hasSupporters && <th style={{ padding: '6px 10px', textAlign: 'right', fontSize: '10px', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.06)', position: 'sticky', top: 0, background: '#1a1a2e' }}>Supporters</th>}
                      {(hasFollowers || hasSubscribers) && <th style={{ padding: '6px 10px', textAlign: 'right', fontSize: '10px', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.06)', position: 'sticky', top: 0, background: '#1a1a2e' }}>{platform === 'substack' ? 'Subs' : 'Followers'}</th>}
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
                        {hasSupporters && <td style={{ padding: '5px 10px', color: 'rgba(255,255,255,0.6)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{entry.supporters != null ? Number(entry.supporters).toLocaleString() : '—'}</td>}
                        {(hasFollowers || hasSubscribers) && <td style={{ padding: '5px 10px', color: 'rgba(255,255,255,0.6)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{entry.followers_total != null ? Number(entry.followers_total).toLocaleString() : '—'}</td>}
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
function parseDate(val, fallbackYear) {
  if (!val) return null;
  const s = String(val).trim();
  const shortMonths = {jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
  const fullMonths = {january:'01',february:'02',march:'03',april:'04',may:'05',june:'06',july:'07',august:'08',september:'09',october:'10',november:'11',december:'12'};
  // "Jan 15, 2025" or "January 15, 2025"
  const m = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const mm = shortMonths[m[1].toLowerCase().slice(0,3)];
    if (mm) return `${m[3]}-${mm}-${m[2].padStart(2,'0')}`;
  }
  // "January 15" or "Jan 15" (no year — use fallbackYear or current year)
  const mNoYear = s.match(/^([A-Za-z]+)\s+(\d{1,2})$/);
  if (mNoYear) {
    const mm = fullMonths[mNoYear[1].toLowerCase()] || shortMonths[mNoYear[1].toLowerCase().slice(0,3)];
    if (mm) {
      const yr = fallbackYear || new Date().getFullYear();
      return `${yr}-${mm}-${mNoYear[2].padStart(2,'0')}`;
    }
  }
  // "2025-01-15"
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
  // "1/15/2025" or "1-15-2025"
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
// RPM Card
// ═══════════════════════════════════════════════
function RPMCard({ revenueData, timeSeries, accounts }) {
  const revenueByAccount = {};
  for (const r of revenueData) {
    if (!revenueByAccount[r.platform_account_id]) revenueByAccount[r.platform_account_id] = 0;
    revenueByAccount[r.platform_account_id] += (r.net_amount_cents || r.amount_cents || 0);
  }

  const viewsByAccount = {};
  for (const r of timeSeries) {
    if (!viewsByAccount[r.platform_account_id]) viewsByAccount[r.platform_account_id] = 0;
    viewsByAccount[r.platform_account_id] += Number(r.total_views) || 0;
  }

  const rows = Object.entries(revenueByAccount)
    .filter(([, cents]) => cents > 0)
    .map(([accountId, cents]) => {
      const acct = accounts.find(a => a.id === accountId);
      const platform = acct?.platform || 'unknown';
      const meta = PLATFORM_META[platform] || { label: platform, color: '#666' };
      const views = viewsByAccount[accountId] || 0;
      const revenue = cents / 100;
      const rpm = views > 0 ? (revenue / (views / 1000)) : 0;
      return { accountId, name: acct?.account_name || meta.label, platform, color: meta.color, revenue, views, rpm };
    })
    .sort((a, b) => b.revenue - a.revenue);

  if (rows.length === 0) return null;

  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totalViews = rows.reduce((s, r) => s + r.views, 0);
  const blendedRpm = totalViews > 0 ? (totalRevenue / (totalViews / 1000)) : 0;
  const maxRevenue = Math.max(...rows.map(r => r.revenue));

  return (
    <div style={{ ...analysisStyles.card, borderLeft: '3px solid #f59e0b' }}>
      <div style={analysisStyles.cardHeader}>
        <span style={{ ...analysisStyles.cardTitle, color: '#f59e0b' }}>Revenue per 1K Views (RPM)</span>
        <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.35)' }}>
          Blended RPM: <strong style={{ color: '#f59e0b' }}>${blendedRpm.toFixed(2)}</strong>
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '12px' }}>
        {rows.map(r => (
          <div key={r.accountId} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '3px', background: r.color, flexShrink: 0 }} />
            <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)', minWidth: '120px', flexShrink: 0 }}>{r.name}</span>
            <div style={{ flex: 1, position: 'relative', height: '22px', background: 'rgba(255,255,255,0.03)', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: '4px',
                background: `linear-gradient(90deg, ${r.color}44, ${r.color}88)`,
                width: `${maxRevenue > 0 ? (r.revenue / maxRevenue) * 100 : 0}%`,
                transition: 'width 0.3s ease',
              }} />
              <span style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', fontSize: '11px', color: '#fff', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                ${r.revenue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              </span>
            </div>
            <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', minWidth: '70px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {formatCompact(r.views)} views
            </span>
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#f59e0b', minWidth: '65px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              ${r.rpm.toFixed(2)}/1K
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// Publish Time Heatmap
// ═══════════════════════════════════════════════
function PublishHeatmap({ contentItems }) {
  const [hoveredCell, setHoveredCell] = useState(null);

  const grid = {};
  for (const item of contentItems) {
    if (!item.published_at) continue;
    const dt = new Date(item.published_at);
    const ptParts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', hour: 'numeric', hour12: false }).formatToParts(dt);
    const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const day = dayMap[ptParts.find(p => p.type === 'weekday')?.value] ?? 0;
    const hour = parseInt(ptParts.find(p => p.type === 'hour')?.value, 10) || 0;
    const key = `${day}-${hour}`;
    if (!grid[key]) grid[key] = { count: 0, totalViews: 0 };
    grid[key].count += 1;
    const views = item.latest_metrics?.[0]?.views || 0;
    grid[key].totalViews += Number(views);
  }

  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const cellW = 28, cellH = 24, labelW = 36, labelH = 20;
  const W = labelW + 24 * cellW + 4;
  const H = labelH + 7 * cellH + 4;

  let maxAvg = 0;
  for (const cell of Object.values(grid)) {
    const avg = cell.count > 0 ? cell.totalViews / cell.count : 0;
    if (avg > maxAvg) maxAvg = avg;
  }

  function cellColor(day, hour) {
    const cell = grid[`${day}-${hour}`];
    if (!cell || cell.count === 0) return 'rgba(255,255,255,0.02)';
    const avg = cell.totalViews / cell.count;
    const intensity = maxAvg > 0 ? avg / maxAvg : 0;
    if (intensity < 0.25) return `rgba(99,102,241,${0.15 + intensity * 0.6})`;
    if (intensity < 0.5) return `rgba(139,92,246,${0.3 + intensity * 0.5})`;
    if (intensity < 0.75) return `rgba(245,158,11,${0.4 + intensity * 0.4})`;
    return `rgba(250,204,21,${0.5 + intensity * 0.4})`;
  }

  return (
    <div style={{ ...analysisStyles.card, borderLeft: '3px solid #8b5cf6' }}>
      <span style={{ ...analysisStyles.cardTitle, color: '#8b5cf6' }}>Best Publish Time</span>
      <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', margin: '4px 0 12px' }}>Average views by day of week and hour (Pacific). Brighter = more views.</p>
      <div style={{ overflowX: 'auto', position: 'relative' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxHeight: '240px' }}>
          {/* Hour labels */}
          {Array.from({ length: 24 }, (_, h) => (
            <text key={h} x={labelW + h * cellW + cellW / 2} y={labelH - 4}
              fill="rgba(255,255,255,0.3)" fontSize="9" textAnchor="middle">{h}</text>
          ))}
          {/* Day labels + cells */}
          {dayLabels.map((label, d) => (
            <g key={d}>
              <text x={labelW - 6} y={labelH + d * cellH + cellH / 2 + 3}
                fill="rgba(255,255,255,0.4)" fontSize="10" textAnchor="end">{label}</text>
              {Array.from({ length: 24 }, (_, h) => {
                const cell = grid[`${d}-${h}`];
                return (
                  <rect key={h}
                    x={labelW + h * cellW + 1} y={labelH + d * cellH + 1}
                    width={cellW - 2} height={cellH - 2}
                    rx="3" fill={cellColor(d, h)}
                    stroke={hoveredCell === `${d}-${h}` ? 'rgba(255,255,255,0.4)' : 'transparent'}
                    strokeWidth="1"
                    onMouseEnter={() => setHoveredCell(`${d}-${h}`)}
                    onMouseLeave={() => setHoveredCell(null)}
                    style={{ cursor: 'default' }}
                  />
                );
              })}
            </g>
          ))}
        </svg>
        {hoveredCell && (() => {
          const [d, h] = hoveredCell.split('-').map(Number);
          const cell = grid[hoveredCell];
          const count = cell?.count || 0;
          const avg = count > 0 ? Math.round(cell.totalViews / count) : 0;
          return (
            <div style={{
              position: 'absolute', top: '4px', right: '8px',
              background: 'rgba(18,18,31,0.95)', border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '8px', padding: '8px 12px', pointerEvents: 'none',
              fontSize: '11px', color: 'rgba(255,255,255,0.6)',
            }}>
              <strong style={{ color: '#fff' }}>{dayLabels[d]} {h}:00 PT</strong>
              <br />{count} post{count !== 1 ? 's' : ''} — avg {formatCompact(avg)} views
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// Content Velocity Scatter Plot
// ═══════════════════════════════════════════════
function ContentVelocityChart({ contentItems }) {
  const [hoveredDot, setHoveredDot] = useState(null);
  const now = new Date();

  const dots = contentItems
    .filter(item => item.published_at && item.latest_metrics?.[0]?.views)
    .map(item => {
      const published = new Date(item.published_at);
      const daysOld = Math.max(1, Math.round((now - published) / 86400000));
      const views = Number(item.latest_metrics[0].views) || 0;
      const platform = item.platform_account?.platform || 'unknown';
      const meta = PLATFORM_META[platform] || { label: platform, color: '#666' };
      return {
        id: item.id, title: item.title || '(Untitled)', daysOld, views,
        platform, color: meta.color, label: meta.label,
        accountName: item.platform_account?.account_name || meta.label,
      };
    })
    .filter(d => d.views > 0);

  if (dots.length === 0) return null;

  const W = 900, H = 340, PAD = { top: 30, right: 30, bottom: 50, left: 60 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const maxDays = Math.max(...dots.map(d => d.daysOld));
  const maxViews = Math.max(...dots.map(d => d.views));
  const logMax = Math.log10(Math.max(maxViews, 10));
  const logMin = 0;

  function xPos(days) { return PAD.left + (days / maxDays) * plotW; }
  function yPos(views) {
    const logVal = views > 0 ? Math.log10(views) : 0;
    return PAD.top + plotH - ((logVal - logMin) / (logMax - logMin)) * plotH;
  }

  // Y-axis ticks (powers of 10)
  const yTicks = [];
  for (let p = 0; p <= Math.ceil(logMax); p++) {
    yTicks.push(Math.pow(10, p));
  }

  // X-axis ticks
  const xTickCount = Math.min(8, maxDays);
  const xTickInterval = Math.max(1, Math.ceil(maxDays / xTickCount));
  const xTicks = [];
  for (let t = 0; t <= maxDays; t += xTickInterval) xTicks.push(t);

  // Legend - unique platforms
  const platforms = [...new Set(dots.map(d => d.platform))];

  return (
    <div style={{ ...analysisStyles.card, borderLeft: '3px solid #3b82f6' }}>
      <div style={analysisStyles.cardHeader}>
        <span style={{ ...analysisStyles.cardTitle, color: '#3b82f6' }}>Content Velocity</span>
        <div style={{ display: 'flex', gap: '12px' }}>
          {platforms.map(p => {
            const meta = PLATFORM_META[p] || { label: p, color: '#666' };
            return (
              <div key={p} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: meta.color }} />
                <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>{meta.label}</span>
              </div>
            );
          })}
        </div>
      </div>
      <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', margin: '4px 0 12px' }}>
        Total views vs days since publish. Dots higher and to the left gained traction fastest.
      </p>
      <div style={{ overflowX: 'auto', position: 'relative' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxHeight: '360px' }}
          onMouseLeave={() => setHoveredDot(null)}>
          {/* Grid */}
          {yTicks.map(t => {
            const y = yPos(t);
            if (y < PAD.top || y > PAD.top + plotH) return null;
            return (
              <g key={t}>
                <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="rgba(255,255,255,0.05)" />
                <text x={PAD.left - 8} y={y + 3} fill="rgba(255,255,255,0.3)" fontSize="10" textAnchor="end">
                  {formatCompact(t)}
                </text>
              </g>
            );
          })}
          {/* X axis labels */}
          {xTicks.map(t => {
            const x = xPos(t);
            return (
              <text key={t} x={x} y={H - 12} fill="rgba(255,255,255,0.3)" fontSize="10" textAnchor="middle">
                {t}d
              </text>
            );
          })}
          {/* Axis labels */}
          <text x={W / 2} y={H - 0} fill="rgba(255,255,255,0.25)" fontSize="10" textAnchor="middle">Days since publish</text>
          <text x={14} y={H / 2} fill="rgba(255,255,255,0.25)" fontSize="10" textAnchor="middle" transform={`rotate(-90, 14, ${H / 2})`}>Views (log scale)</text>
          {/* Dots */}
          {dots.map((d, i) => (
            <circle key={d.id}
              cx={xPos(d.daysOld)} cy={yPos(d.views)}
              r={hoveredDot === i ? 6 : 4}
              fill={d.color} fillOpacity={hoveredDot === i ? 1 : 0.7}
              stroke={hoveredDot === i ? '#fff' : d.color} strokeWidth={hoveredDot === i ? 2 : 0.5}
              onMouseEnter={() => setHoveredDot(i)}
              style={{ cursor: 'pointer', transition: 'r 0.15s' }}
            />
          ))}
        </svg>
        {hoveredDot !== null && dots[hoveredDot] && (() => {
          const d = dots[hoveredDot];
          const xPct = (xPos(d.daysOld) / W) * 100;
          return (
            <div style={{
              position: 'absolute', top: '8px',
              left: `${xPct}%`,
              transform: xPct > 70 ? 'translateX(-110%)' : 'translateX(10px)',
              background: 'rgba(18,18,31,0.95)', border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '8px', padding: '10px 14px', pointerEvents: 'none',
              maxWidth: '280px', zIndex: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#fff', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {d.title}
              </div>
              <div style={{ display: 'flex', gap: '8px', fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>
                <span style={{ color: d.color }}>{d.label}</span>
                <span>{formatCompact(d.views)} views</span>
                <span>{d.daysOld}d old</span>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// Upload Frequency vs Growth
// ═══════════════════════════════════════════════
function FrequencyGrowthChart({ contentItems, audienceSnapshots, accounts }) {
  // Group content by ISO week
  const weekPosts = {};
  for (const item of contentItems) {
    if (!item.published_at) continue;
    const dt = new Date(item.published_at);
    const week = getISOWeekKey(dt);
    if (!weekPosts[week]) weekPosts[week] = { count: 0, byPlatform: {} };
    weekPosts[week].count += 1;
    const platform = (() => {
      const acct = accounts.find(a => a.id === item.platform_account_id);
      return acct?.platform || 'unknown';
    })();
    weekPosts[week].byPlatform[platform] = (weekPosts[week].byPlatform[platform] || 0) + 1;
  }

  // Group follower gains by ISO week
  const weekFollowers = {};
  for (const snap of audienceSnapshots) {
    if (!snap.date) continue;
    const dt = new Date(snap.date + 'T00:00:00');
    const week = getISOWeekKey(dt);
    if (!weekFollowers[week]) weekFollowers[week] = 0;
    weekFollowers[week] += Number(snap.followers_gained) || 0;
  }

  // Merge weeks
  const allWeeks = [...new Set([...Object.keys(weekPosts), ...Object.keys(weekFollowers)])].sort();
  if (allWeeks.length < 2) return null;

  const data = allWeeks.map(week => ({
    week,
    posts: weekPosts[week]?.count || 0,
    byPlatform: weekPosts[week]?.byPlatform || {},
    followersGained: weekFollowers[week] || 0,
  }));

  const W = 900, H = 300, PAD = { top: 30, right: 60, bottom: 45, left: 50 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const maxPosts = Math.max(...data.map(d => d.posts), 1);
  const maxFol = Math.max(...data.map(d => Math.abs(d.followersGained)), 1);
  const minFol = Math.min(...data.map(d => d.followersGained), 0);
  const folRange = Math.max(maxFol, Math.abs(minFol)) || 1;

  const barW = Math.min(plotW / data.length * 0.6, 40);
  const xStep = plotW / Math.max(data.length - 1, 1);

  // Platforms for stacked bars
  const allPlatforms = [...new Set(data.flatMap(d => Object.keys(d.byPlatform)))];

  // Line path for followers
  const linePoints = data.map((d, i) => {
    const x = PAD.left + i * xStep;
    const y = PAD.top + plotH / 2 - (d.followersGained / folRange) * (plotH / 2);
    return { x, y };
  });
  const linePath = linePoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  // Zero line for followers
  const zeroY = PAD.top + plotH / 2;

  const [hoveredWeek, setHoveredWeek] = useState(null);

  // X-axis tick filtering
  const tickCount = Math.min(data.length, 10);
  const tickInterval = Math.max(1, Math.floor(data.length / tickCount));

  return (
    <div style={{ ...analysisStyles.card, borderLeft: '3px solid #22c55e' }}>
      <div style={analysisStyles.cardHeader}>
        <span style={{ ...analysisStyles.cardTitle, color: '#22c55e' }}>Upload Frequency vs Growth</span>
        <div style={{ display: 'flex', gap: '16px', fontSize: '11px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '12px', height: '8px', borderRadius: '2px', background: 'rgba(99,102,241,0.6)' }} />
            <span style={{ color: 'rgba(255,255,255,0.4)' }}>Posts/week</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '12px', height: '2px', background: '#22c55e' }} />
            <span style={{ color: 'rgba(255,255,255,0.4)' }}>Followers gained</span>
          </div>
        </div>
      </div>
      <div style={{ overflowX: 'auto', position: 'relative' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxHeight: '320px' }}
          onMouseLeave={() => setHoveredWeek(null)}>
          {/* Grid */}
          {[0, 0.25, 0.5, 0.75, 1].map(pct => {
            const y = PAD.top + plotH * pct;
            return <line key={pct} x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="rgba(255,255,255,0.04)" />;
          })}
          {/* Zero line */}
          <line x1={PAD.left} y1={zeroY} x2={W - PAD.right} y2={zeroY} stroke="rgba(255,255,255,0.1)" strokeDasharray="4,3" />
          {/* Left Y axis labels (posts) */}
          {[0, Math.round(maxPosts / 2), maxPosts].map(v => {
            const y = PAD.top + plotH - (v / maxPosts) * plotH;
            return <text key={v} x={PAD.left - 8} y={y + 3} fill="rgba(99,102,241,0.5)" fontSize="10" textAnchor="end">{v}</text>;
          })}
          {/* Right Y axis labels (followers) */}
          {[folRange, 0, -folRange].map((v, i) => {
            const y = PAD.top + (i / 2) * plotH;
            return <text key={i} x={W - PAD.right + 8} y={y + 3} fill="rgba(34,197,94,0.5)" fontSize="10" textAnchor="start">{v >= 0 ? '+' : ''}{formatCompact(v)}</text>;
          })}
          {/* Stacked bars */}
          {data.map((d, i) => {
            const x = PAD.left + i * xStep - barW / 2;
            const totalBarH = (d.posts / maxPosts) * plotH;
            let cumH = 0;
            return (
              <g key={i}>
                {allPlatforms.map(platform => {
                  const count = d.byPlatform[platform] || 0;
                  if (count === 0) return null;
                  const segH = (count / maxPosts) * plotH;
                  const meta = PLATFORM_META[platform] || { color: '#666' };
                  const barY = PAD.top + plotH - cumH - segH;
                  cumH += segH;
                  return (
                    <rect key={platform} x={x} y={barY} width={barW} height={segH}
                      fill={meta.color} fillOpacity={0.6} rx="2" />
                  );
                })}
              </g>
            );
          })}
          {/* Followers line */}
          <path d={linePath} fill="none" stroke="#22c55e" strokeWidth="2" strokeLinejoin="round" />
          {linePoints.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={hoveredWeek === i ? 4 : 2.5}
              fill="#22c55e" stroke="#12121f" strokeWidth="1" />
          ))}
          {/* X-axis labels */}
          {data.map((d, i) => {
            if (data.length > 10 && i !== 0 && i !== data.length - 1 && i % tickInterval !== 0) return null;
            const x = PAD.left + i * xStep;
            return (
              <text key={i} x={x} y={H - 8} fill="rgba(255,255,255,0.3)" fontSize="9" textAnchor="middle"
                transform={`rotate(-30, ${x}, ${H - 8})`}>
                {d.week}
              </text>
            );
          })}
          {/* Hover guide */}
          {hoveredWeek !== null && (
            <line x1={PAD.left + hoveredWeek * xStep} y1={PAD.top}
              x2={PAD.left + hoveredWeek * xStep} y2={PAD.top + plotH}
              stroke="rgba(255,255,255,0.15)" strokeWidth="1" strokeDasharray="4,3" />
          )}
          {/* Invisible hover rects */}
          {data.map((d, i) => (
            <rect key={i} x={PAD.left + i * xStep - xStep / 2} y={PAD.top}
              width={xStep} height={plotH} fill="transparent"
              onMouseEnter={() => setHoveredWeek(i)} />
          ))}
        </svg>
        {hoveredWeek !== null && data[hoveredWeek] && (() => {
          const d = data[hoveredWeek];
          const xPct = ((PAD.left + hoveredWeek * xStep) / W) * 100;
          return (
            <div style={{
              position: 'absolute', top: '8px',
              left: `${xPct}%`,
              transform: xPct > 70 ? 'translateX(-110%)' : 'translateX(10px)',
              background: 'rgba(18,18,31,0.95)', border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '8px', padding: '10px 14px', pointerEvents: 'none',
              zIndex: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#fff', marginBottom: '6px' }}>Week of {d.week}</div>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginBottom: '3px' }}>
                Posts: <strong style={{ color: '#a5b4fc' }}>{d.posts}</strong>
              </div>
              {Object.entries(d.byPlatform).map(([p, count]) => (
                <div key={p} style={{ fontSize: '10px', color: PLATFORM_META[p]?.color || '#666', paddingLeft: '8px' }}>
                  {PLATFORM_META[p]?.label || p}: {count}
                </div>
              ))}
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginTop: '4px' }}>
                Followers: <strong style={{ color: d.followersGained >= 0 ? '#4ade80' : '#f87171' }}>
                  {d.followersGained >= 0 ? '+' : ''}{formatCompact(d.followersGained)}
                </strong>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function getISOWeekKey(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay() + 1); // Monday
  return d.toISOString().slice(0, 10);
}

// ═══════════════════════════════════════════════
// Analysis Styles
// ═══════════════════════════════════════════════
const analysisStyles = {
  card: {
    background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '12px', padding: '20px', marginBottom: '16px',
  },
  cardHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px',
  },
  cardTitle: { fontSize: '15px', fontWeight: 700 },
};

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

  // View toggle
  viewToggleBar: { display: 'flex', gap: '2px', padding: '3px', background: 'rgba(255,255,255,0.04)', borderRadius: '10px', width: 'fit-content', marginBottom: '20px' },
  viewToggleBtn: { padding: '7px 18px', borderRadius: '8px', border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.4)', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  viewToggleBtnActive: { padding: '7px 18px', borderRadius: '8px', border: 'none', background: 'rgba(99,102,241,0.2)', color: '#a5b4fc', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
};
