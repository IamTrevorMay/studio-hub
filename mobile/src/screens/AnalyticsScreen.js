import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  ScrollView, RefreshControl, ActivityIndicator,
} from 'react-native';
import { useSupabaseQuery } from '../hooks/useSupabaseQuery';
import { supabase } from '../services/supabase';
import { colors, spacing, radius, fontSize } from '../utils/theme';

const PLATFORM_META = {
  youtube:    { label: 'YouTube',    color: '#FF0000' },
  facebook:   { label: 'Facebook',   color: '#1877F2' },
  instagram:  { label: 'Instagram',  color: '#E4405F' },
  tiktok:     { label: 'TikTok',     color: '#00F2EA' },
  substack:   { label: 'Substack',   color: '#FF6719' },
  twitch:     { label: 'Twitch',     color: '#9146FF' },
  stripe:     { label: 'Stripe',     color: '#635BFF' },
  fourthwall: { label: 'Fourthwall', color: '#E8451C' },
};

const DATE_RANGES = [
  { key: '7d', label: '7d', days: 7 },
  { key: '30d', label: '30d', days: 30 },
  { key: '90d', label: '90d', days: 90 },
  { key: '1y', label: '1y', days: 365 },
];

const REVENUE_CATEGORIES = {
  merch:        { label: 'Merch',          color: '#f97316' },
  subscription: { label: 'Subscriptions',  color: '#8b5cf6' },
  sponsorship:  { label: 'Sponsorships',   color: '#10b981' },
  ad_revenue:   { label: 'Ad Revenue',     color: '#3b82f6' },
  other:        { label: 'Other',          color: '#6b7280' },
};

function todayStr() { return new Date().toISOString().split('T')[0]; }
function daysAgoStr(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().split('T')[0]; }

function formatCompact(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  if (n % 1 !== 0) return n.toFixed(1);
  return n.toLocaleString();
}

function formatCurrency(cents) {
  return '$' + (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function pctChange(curr, prev) {
  if (prev === 0) return curr > 0 ? 100 : 0;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

// ── Sparkline: horizontal bar chart from time series ──
function Sparkline({ data, getValue, color, height = 40 }) {
  if (!data || data.length === 0) return null;
  const values = data.map(getValue);
  const max = Math.max(...values, 1);
  const barWidth = Math.max(1, Math.floor((300 - data.length) / data.length));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', height, gap: 1 }}>
      {values.map((v, i) => (
        <View
          key={i}
          style={{
            width: barWidth,
            height: Math.max(1, (v / max) * height),
            backgroundColor: color,
            borderRadius: 1,
            opacity: 0.8,
          }}
        />
      ))}
    </View>
  );
}

// ── Donut row: platform breakdown as colored bar + legend ──
function BreakdownCard({ title, color: accentColor, data, valueKey, formatValue }) {
  const total = data.reduce((s, d) => s + (d[valueKey] || 0), 0);
  if (total === 0) return null;
  return (
    <View style={[styles.section, { borderLeftWidth: 3, borderLeftColor: accentColor }]}>
      <Text style={[styles.sectionTitle, { color: accentColor }]}>{title}</Text>
      {/* Stacked bar */}
      <View style={styles.barContainer}>
        {data.filter(d => d[valueKey] > 0).map((d, i) => (
          <View key={i} style={{ flex: d[valueKey], height: 8, backgroundColor: d.color }} />
        ))}
      </View>
      {/* Legend */}
      {data.filter(d => d[valueKey] > 0).map((d, i) => {
        const pct = ((d[valueKey] / total) * 100).toFixed(1);
        return (
          <View key={i} style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: d.color }]} />
            <Text style={styles.legendLabel}>{d.label}</Text>
            <Text style={styles.legendValue}>
              {formatValue ? formatValue(d[valueKey]) : formatCompact(d[valueKey])}
            </Text>
            <Text style={styles.legendPct}>{pct}%</Text>
          </View>
        );
      })}
    </View>
  );
}

export default function AnalyticsScreen() {
  const { safeQuery } = useSupabaseQuery();
  const [viewMode, setViewMode] = useState('dashboard');
  const [dateRange, setDateRange] = useState('30d');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Dashboard data
  const [kpi, setKpi] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [timeSeries, setTimeSeries] = useState([]);

  // Revenue data
  const [revenueEvents, setRevenueEvents] = useState([]);
  const [revByCategory, setRevByCategory] = useState({});

  const range = useMemo(() => {
    const days = (DATE_RANGES.find(r => r.key === dateRange) || {}).days || 30;
    return { start: daysAgoStr(days), end: todayStr() };
  }, [dateRange]);

  const prevRange = useMemo(() => {
    const days = (DATE_RANGES.find(r => r.key === dateRange) || {}).days || 30;
    return { start: daysAgoStr(days * 2), end: daysAgoStr(days + 1) };
  }, [dateRange]);

  // ── Fetch accounts ──
  useEffect(() => {
    (async () => {
      const { data } = await safeQuery(() =>
        supabase.from('platform_accounts').select('*').eq('is_active', true).order('platform')
      );
      if (data) setAccounts(data);
    })();
  }, [safeQuery]);

  // ── Fetch KPI + time series ──
  const fetchDashboard = useCallback(async () => {
    const [rollups, prevRollups, revenue, prevRevenue, audience] = await Promise.all([
      safeQuery(() =>
        supabase.from('daily_platform_rollups').select('*')
          .gte('date', range.start).lte('date', range.end).order('date', { ascending: true })
      ),
      safeQuery(() =>
        supabase.from('daily_platform_rollups').select('*')
          .gte('date', prevRange.start).lte('date', prevRange.end)
      ),
      safeQuery(() =>
        supabase.from('revenue_events').select('net_amount_cents, event_type')
          .gte('occurred_at', range.start).lte('occurred_at', range.end + 'T23:59:59')
          .in('event_type', ['charge', 'subscription_renewal', 'sponsorship'])
      ),
      safeQuery(() =>
        supabase.from('revenue_events').select('net_amount_cents')
          .gte('occurred_at', prevRange.start).lte('occurred_at', prevRange.end + 'T23:59:59')
          .in('event_type', ['charge', 'subscription_renewal', 'sponsorship'])
      ),
      safeQuery(() =>
        supabase.from('audience_snapshots')
          .select('followers_total, followers_gained, platform_account_id')
          .eq('date', range.end)
      ),
    ]);

    const r = rollups.data || [];
    const pr = prevRollups.data || [];
    const rev = revenue.data || [];
    const prevRev = prevRevenue.data || [];
    const aud = audience.data || [];

    // Store raw time series
    setTimeSeries(r);

    const totalViews = r.reduce((s, x) => s + Number(x.total_views), 0);
    const prevViews = pr.reduce((s, x) => s + Number(x.total_views), 0);
    const totalRev = rev.reduce((s, x) => s + x.net_amount_cents, 0);
    const pRev = prevRev.reduce((s, x) => s + x.net_amount_cents, 0);
    const totalFollowers = aud.reduce((s, a) => s + Number(a.followers_total), 0);
    const followersGained = aud.reduce((s, a) => s + Number(a.followers_gained), 0);
    const avgEng = r.length > 0 ? r.reduce((s, x) => s + Number(x.avg_engagement_rate), 0) / r.length : 0;
    const prevAvgEng = pr.length > 0 ? pr.reduce((s, x) => s + Number(x.avg_engagement_rate), 0) / pr.length : 0;

    setKpi({
      totalViews, totalRevenue: totalRev, totalFollowers, avgEngagement: avgEng,
      viewsChange: pctChange(totalViews, prevViews),
      revenueChange: pctChange(totalRev, pRev),
      followersChange: followersGained,
      engagementChange: pctChange(avgEng, prevAvgEng),
    });
  }, [safeQuery, range, prevRange]);

  // ── Fetch revenue ──
  const fetchRevenue = useCallback(async () => {
    const { data } = await safeQuery(() =>
      supabase.from('revenue_events')
        .select('id, net_amount_cents, product_category, event_type, occurred_at, description, platform_account_id, platform_accounts(platform, account_name)')
        .gte('occurred_at', range.start)
        .lte('occurred_at', range.end + 'T23:59:59')
        .in('event_type', ['charge', 'subscription_renewal', 'sponsorship'])
        .order('occurred_at', { ascending: false })
    );
    const events = data || [];
    setRevenueEvents(events);

    const byCat = {};
    for (const ev of events) {
      const cat = ev.product_category || 'other';
      byCat[cat] = (byCat[cat] || 0) + ev.net_amount_cents;
    }
    setRevByCategory(byCat);
  }, [safeQuery, range]);

  // ── Load ──
  const loadAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchDashboard(), fetchRevenue()]);
    setLoading(false);
  }, [fetchDashboard, fetchRevenue]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchDashboard(), fetchRevenue()]);
    setRefreshing(false);
  }, [fetchDashboard, fetchRevenue]);

  // ── Aggregate time series by date ──
  const aggregated = useMemo(() => {
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
      .map(d => ({ ...d, avg_engagement_rate: d._count > 0 ? d.avg_engagement_rate / d._count : 0 }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [timeSeries]);

  // ── Platform breakdown ──
  const platformBreakdown = useMemo(() => {
    const byAccount = {};
    for (const row of timeSeries) {
      const key = row.platform_account_id;
      if (!byAccount[key]) byAccount[key] = { views: 0, revenue: 0, followers: 0 };
      byAccount[key].views += Number(row.total_views) || 0;
      byAccount[key].revenue += Number(row.revenue_cents) || 0;
      const fol = Number(row.followers_eod) || 0;
      if (fol > byAccount[key].followers) byAccount[key].followers = fol;
    }
    return accounts
      .filter(a => byAccount[a.id])
      .map(a => {
        const meta = PLATFORM_META[a.platform] || { label: a.platform, color: '#6b7280' };
        const vals = byAccount[a.id];
        return { label: meta.label, color: meta.color, views: vals.views, revenue: vals.revenue, followers: vals.followers };
      });
  }, [timeSeries, accounts]);

  const totalRevByCat = Object.values(revByCategory).reduce((s, v) => s + v, 0);

  function KPICard({ label, value, change, isCurrency, isPercent, isCount }) {
    const changeColor = change > 0 ? colors.green : change < 0 ? colors.red : colors.textTertiary;
    const arrow = change > 0 ? '+' : '';
    return (
      <View style={styles.kpiCard}>
        <Text style={styles.kpiLabel}>{label}</Text>
        <Text style={styles.kpiValue}>
          {isCurrency ? formatCurrency(value) : isPercent ? (value * 100).toFixed(1) + '%' : formatCompact(value)}
        </Text>
        <Text style={[styles.kpiChange, { color: changeColor }]}>
          {isCount ? `${arrow}${formatCompact(change)}` : `${arrow}${change.toFixed(1)}%`}
        </Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* View mode toggle */}
      <View style={styles.tabRow}>
        {['dashboard', 'revenue'].map(mode => (
          <TouchableOpacity
            key={mode}
            style={[styles.tab, viewMode === mode && styles.tabActive]}
            onPress={() => setViewMode(mode)}
          >
            <Text style={[styles.tabText, viewMode === mode && styles.tabTextActive]}>
              {mode === 'dashboard' ? 'Dashboard' : 'Revenue'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Date range selector */}
      <View style={styles.dateRow}>
        {DATE_RANGES.map(r => (
          <TouchableOpacity
            key={r.key}
            style={[styles.dateChip, dateRange === r.key && styles.dateChipActive]}
            onPress={() => setDateRange(r.key)}
          >
            <Text style={[styles.dateChipText, dateRange === r.key && styles.dateChipTextActive]}>{r.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {viewMode === 'dashboard' ? (
        /* ── DASHBOARD ── */
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        >
          {kpi && (
            <>
              <View style={styles.kpiGrid}>
                <KPICard label="Total Views" value={kpi.totalViews} change={kpi.viewsChange} />
                <KPICard label="Revenue" value={kpi.totalRevenue} change={kpi.revenueChange} isCurrency />
              </View>
              <View style={styles.kpiGrid}>
                <KPICard label="Followers" value={kpi.totalFollowers} change={kpi.followersChange} isCount />
                <KPICard label="Avg Engagement" value={kpi.avgEngagement} change={kpi.engagementChange} isPercent />
              </View>
            </>
          )}

          {/* Trend sparklines */}
          {aggregated.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Trends</Text>

              <Text style={styles.sparkLabel}>Views</Text>
              <Sparkline data={aggregated} getValue={d => d.total_views} color="#6366f1" />

              <Text style={[styles.sparkLabel, { marginTop: spacing.md }]}>Revenue</Text>
              <Sparkline data={aggregated} getValue={d => d.revenue_cents} color="#f59e0b" />

              <Text style={[styles.sparkLabel, { marginTop: spacing.md }]}>Engagement</Text>
              <Sparkline data={aggregated} getValue={d => d.avg_engagement_rate} color="#22c55e" />

              <Text style={[styles.sparkLabel, { marginTop: spacing.md }]}>Followers</Text>
              <Sparkline data={aggregated} getValue={d => d.followers_eod} color="#ec4899" />
            </View>
          )}

          {/* Platform breakdowns */}
          <BreakdownCard
            title="Views by Platform"
            color="#6366f1"
            data={platformBreakdown}
            valueKey="views"
          />
          <BreakdownCard
            title="Revenue by Platform"
            color="#f59e0b"
            data={platformBreakdown}
            valueKey="revenue"
            formatValue={v => formatCurrency(v)}
          />
          <BreakdownCard
            title="Followers by Platform"
            color="#ec4899"
            data={platformBreakdown}
            valueKey="followers"
          />
        </ScrollView>
      ) : (
        /* ── REVENUE ── */
        <FlatList
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListHeaderComponent={
            <>
              {/* Category breakdown */}
              {totalRevByCat > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>
                    Revenue by Category  ·  {formatCurrency(totalRevByCat)}
                  </Text>
                  {Object.entries(REVENUE_CATEGORIES).map(([key, meta]) => {
                    const amt = revByCategory[key] || 0;
                    if (amt === 0) return null;
                    const pct = (amt / totalRevByCat * 100).toFixed(1);
                    return (
                      <View key={key} style={styles.legendRow}>
                        <View style={[styles.legendDot, { backgroundColor: meta.color }]} />
                        <Text style={styles.legendLabel}>{meta.label}</Text>
                        <Text style={styles.legendValue}>{formatCurrency(amt)}</Text>
                        <Text style={styles.legendPct}>{pct}%</Text>
                      </View>
                    );
                  })}
                  <View style={styles.barContainer}>
                    {Object.entries(REVENUE_CATEGORIES).map(([key, meta]) => {
                      const amt = revByCategory[key] || 0;
                      if (amt === 0) return null;
                      return (
                        <View key={key} style={{ flex: amt, height: 8, backgroundColor: meta.color }} />
                      );
                    })}
                  </View>
                </View>
              )}

              <Text style={styles.sectionTitle}>
                Recent Events ({revenueEvents.length})
              </Text>
            </>
          }
          data={revenueEvents.slice(0, 50)}
          keyExtractor={item => item.id}
          renderItem={({ item }) => {
            const catMeta = REVENUE_CATEGORIES[item.product_category] || REVENUE_CATEGORIES.other;
            return (
              <View style={styles.eventCard}>
                <View style={styles.eventHeader}>
                  <View style={[styles.legendDot, { backgroundColor: catMeta.color }]} />
                  <Text style={styles.eventType}>{catMeta.label}</Text>
                  <Text style={styles.eventAmount}>{formatCurrency(item.net_amount_cents)}</Text>
                </View>
                {item.description ? (
                  <Text style={styles.eventDesc} numberOfLines={1}>{item.description}</Text>
                ) : null}
                <Text style={styles.eventDate}>
                  {formatDate(item.occurred_at)}
                  {item.platform_accounts ? `  ·  ${item.platform_accounts.account_name || item.platform_accounts.platform}` : ''}
                </Text>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyCard}><Text style={styles.emptyText}>No revenue events for this period</Text></View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.xl },
  tabRow: { flexDirection: 'row', paddingHorizontal: spacing.xl, paddingTop: spacing.md, gap: spacing.sm },
  tab: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
  },
  tabActive: { backgroundColor: colors.primaryLight },
  tabText: { fontSize: fontSize.sm, color: colors.textSecondary, fontWeight: '600' },
  tabTextActive: { color: colors.primary },
  dateRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  dateChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
  },
  dateChipActive: { backgroundColor: colors.primaryLight },
  dateChipText: { fontSize: fontSize.xs, color: colors.textSecondary },
  dateChipTextActive: { color: colors.primary, fontWeight: '600' },
  kpiGrid: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  kpiCard: {
    flex: 1,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  kpiLabel: { fontSize: fontSize.xs, color: colors.textSecondary, marginBottom: spacing.xs },
  kpiValue: { fontSize: fontSize.xl, fontWeight: '700', color: colors.text },
  kpiChange: { fontSize: fontSize.xs, fontWeight: '600', marginTop: spacing.xs },
  section: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  sectionTitle: { fontSize: fontSize.base, fontWeight: '700', color: colors.text, marginBottom: spacing.md },
  sparkLabel: { fontSize: fontSize.xs, color: colors.textSecondary, marginBottom: spacing.xs },
  barContainer: { flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', marginTop: spacing.sm },
  legendRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  legendDot: { width: 10, height: 10, borderRadius: 3, marginRight: spacing.sm },
  legendLabel: { flex: 1, fontSize: fontSize.sm, color: colors.textSecondary },
  legendValue: { fontSize: fontSize.sm, fontWeight: '600', color: colors.text, marginRight: spacing.sm },
  legendPct: { fontSize: fontSize.xs, color: colors.textTertiary, width: 40, textAlign: 'right' },
  eventCard: {
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  eventHeader: { flexDirection: 'row', alignItems: 'center' },
  eventType: { flex: 1, fontSize: fontSize.sm, color: colors.textSecondary, marginLeft: spacing.sm },
  eventAmount: { fontSize: fontSize.base, fontWeight: '700', color: colors.text },
  eventDesc: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: spacing.xs },
  eventDate: { fontSize: fontSize.xs, color: colors.textTertiary, marginTop: spacing.xs },
  emptyCard: { padding: spacing.xxxl, alignItems: 'center' },
  emptyText: { fontSize: fontSize.md, color: colors.textTertiary },
});
