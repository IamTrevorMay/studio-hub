import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../../supabaseClient';
import { PLATFORM_META } from '../constants';
import { formatCompact, formatCurrency, daysAgoStr, pctChange } from '../utils';
import { ptDateToUtcISO, ptDayKey } from '../../../lib/ptDate';
import { styles } from '../styles';
import KPICard from './KPICard';
import TrendChart from './TrendChart';

class PlatformViewErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return <div style={{ padding: 24, color: '#f87171', fontSize: 13 }}>
        <p style={{ fontWeight: 600 }}>Platform view error:</p>
        <pre style={{ whiteSpace: 'pre-wrap', color: 'rgba(255,255,255,0.55)' }}>{this.state.error.message}</pre>
      </div>;
    }
    return this.props.children;
  }
}

function PlatformView({ accountId, accounts, start, end }) {
  const [platData, setPlatData] = useState({ rollups: [], content: [], audience: [] });
  const [platLoading, setPlatLoading] = useState(true);
  const [sortCol, setSortCol] = useState('published_at');
  const [sortDir, setSortDir] = useState('desc');

  const account = accounts.find(a => a.id === accountId);
  const meta = PLATFORM_META[account?.platform] || {};
  const color = meta.color || '#6366f1';

  // Previous period
  const daySpan = Math.max(1, Math.ceil((new Date(end) - new Date(start)) / 86400000));
  const prevStart = daysAgoStr(daySpan * 2 + Math.ceil((new Date() - new Date(end)) / 86400000));
  const prevEnd = start;

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    async function load() {
      setPlatLoading(true);
      const queries = [
        supabase.from('daily_platform_rollups').select('*').eq('platform_account_id', accountId).gte('date', start).lte('date', end).order('date'),
        supabase.from('daily_platform_rollups').select('*').eq('platform_account_id', accountId).gte('date', prevStart).lt('date', prevEnd),
        supabase.from('content_items')
          .select('id, title, published_at, url, content_type, duration_seconds, latest_metrics:content_metrics(views, likes, comments, shares, engagement_rate)')
          .eq('platform_account_id', accountId).gte('published_at', ptDateToUtcISO(start)).lt('published_at', ptDateToUtcISO(end, true))
          .order('published_at', { ascending: false }).limit(100),
        supabase.from('audience_snapshots').select('date, followers_total, followers_gained').eq('platform_account_id', accountId).gte('date', start).lte('date', end).order('date'),
        supabase.from('audience_snapshots').select('date, followers_total, followers_gained').eq('platform_account_id', accountId).gte('date', prevStart).lt('date', prevEnd).order('date'),
      ];
      // YouTube: also fetch impressions from analytics_youtube_daily
      const isYouTube = account?.platform === 'youtube';
      if (isYouTube) {
        queries.push(
          supabase.from('analytics_youtube_daily').select('date, impressions, impressions_ctr').eq('platform_account_id', accountId).gte('date', start).lte('date', end).order('date'),
          supabase.from('analytics_youtube_daily').select('date, impressions').eq('platform_account_id', accountId).gte('date', prevStart).lt('date', prevEnd),
        );
      }
      // Fourthwall: fetch revenue_events instead of rollups/content/audience
      const isFourthwall = account?.platform === 'fourthwall';
      if (isFourthwall) {
        const [revRes, prevRevRes] = await Promise.all([
          supabase.from('revenue_events').select('*').eq('platform_account_id', accountId).gte('occurred_at', ptDateToUtcISO(start)).lt('occurred_at', ptDateToUtcISO(end, true)).order('occurred_at', { ascending: false }),
          supabase.from('revenue_events').select('amount_cents, net_amount_cents, occurred_at').eq('platform_account_id', accountId).gte('occurred_at', ptDateToUtcISO(prevStart)).lt('occurred_at', ptDateToUtcISO(prevEnd)),
        ]);
        if (cancelled) return;
        setPlatData({ rollups: [], prevRollups: [], content: [], audience: [], prevAudience: [], ytDaily: [], prevYtDaily: [], fwOrders: revRes.data || [], prevFwOrders: prevRevRes.data || [] });
        setPlatLoading(false);
        return;
      }

      const results = await Promise.all(queries);
      const [rollupRes, prevRollupRes, contentRes, audRes, prevAudRes] = results;
      if (cancelled) return;
      setPlatData({
        rollups: rollupRes.data || [],
        prevRollups: prevRollupRes.data || [],
        content: [],
        audience: audRes.data || [],
        prevAudience: prevAudRes.data || [],
        ytDaily: isYouTube ? (results[5]?.data || []) : [],
        prevYtDaily: isYouTube ? (results[6]?.data || []) : [],
      });
      setPlatLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [accountId, start, end]);

  function handleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('desc'); }
  }

  // Sort content. Must run unconditionally — previously declared after the
  // early return below, which violated the Rules of Hooks (error #310) every
  // time platLoading flipped from true to false.
  const sortedContent = useMemo(() => {
    return [...(platData.content || [])].sort((a, b) => {
      let va, vb;
      if (sortCol === 'published_at') { va = a.published_at || ''; vb = b.published_at || ''; }
      else if (sortCol === 'views') { va = a.metrics?.views || 0; vb = b.metrics?.views || 0; }
      else if (sortCol === 'likes') { va = a.metrics?.likes || 0; vb = b.metrics?.likes || 0; }
      else if (sortCol === 'engagement_rate') { va = a.metrics?.engagement_rate || 0; vb = b.metrics?.engagement_rate || 0; }
      else { va = a[sortCol] || ''; vb = b[sortCol] || ''; }
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortDir === 'asc' ? va - vb : vb - va;
    });
  }, [platData.content, sortCol, sortDir]);

  if (platLoading) return <p style={styles.loadingText}>Loading {meta.label || 'platform'} data...</p>;

  // KPI aggregation
  const totalViews = platData.rollups.reduce((s, r) => s + (Number(r.total_views) || 0), 0);
  const prevViews = (platData.prevRollups || []).reduce((s, r) => s + (Number(r.total_views) || 0), 0);
  const totalLikes = platData.rollups.reduce((s, r) => s + (Number(r.total_likes) || 0), 0);
  const prevLikes = (platData.prevRollups || []).reduce((s, r) => s + (Number(r.total_likes) || 0), 0);
  const latestFollowers = platData.audience.length > 0 ? Number(platData.audience[platData.audience.length - 1].followers_total) || 0 : 0;
  const prevFollowers = (platData.prevAudience || []).length > 0 ? Number(platData.prevAudience[platData.prevAudience.length - 1].followers_total) || 0 : 0;
  const followersGained = platData.audience.reduce((s, a) => s + (a.followers_gained || 0), 0);
  const totalEngagement = platData.rollups.reduce((s, r) => s + Number(r.total_likes || 0) + Number(r.total_comments || 0) + Number(r.total_shares || 0), 0);
  const prevEngagement = (platData.prevRollups || []).reduce((s, r) => s + Number(r.total_likes || 0) + Number(r.total_comments || 0) + Number(r.total_shares || 0), 0);

  // YouTube impressions
  const isYouTube = account?.platform === 'youtube';
  const totalImpressions = (platData.ytDaily || []).reduce((s, r) => s + Number(r.impressions || 0), 0);
  const prevImpressions = (platData.prevYtDaily || []).reduce((s, r) => s + Number(r.impressions || 0), 0);

  // ── Fourthwall view ──
  const isFourthwall = account?.platform === 'fourthwall';
  if (isFourthwall) {
    const orders = platData.fwOrders || [];
    const prevOrders = platData.prevFwOrders || [];
    const fwColor = '#E8451C';

    const totalRevenue = orders.reduce((s, o) => s + (o.amount_cents || 0), 0);
    const netRevenue = orders.reduce((s, o) => s + (o.net_amount_cents || 0), 0);
    const prevRevenue = prevOrders.reduce((s, o) => s + (o.amount_cents || 0), 0);
    const prevNet = prevOrders.reduce((s, o) => s + (o.net_amount_cents || 0), 0);
    const avgOrder = orders.length > 0 ? totalRevenue / orders.length : 0;
    const prevAvg = prevOrders.length > 0 ? prevRevenue / prevOrders.length : 0;

    // Per-order take-home profit in cents.
    //   profit = net − items_cost − processing_fee
    // Fourthwall's Open API does not expose their processing fee, so we
    // estimate it with the standard card rate (2.9% + $0.30 of gross).
    // This reproduces the "your profit" figure shown on the Fourthwall
    // dashboard within rounding. Returns null when an order has no items[]
    // cost data so a "no cost data" row stays distinguishable from a
    // genuine $0 profit.
    const FW_FEE_RATE = 0.029;
    const FW_FEE_FIXED_CENTS = 30;
    const orderProfitCents = (o) => {
      const items = o.metadata?.items || [];
      if (items.length === 0) return null;
      const gross = o.amount_cents || 0;
      const net = o.net_amount_cents || 0;
      if (gross <= 0) return null;
      const cost = items.reduce((s, item) =>
        s + Math.round((item.unit_cost || 0) * (item.quantity || 1) * 100), 0);
      const fee = Math.round(gross * FW_FEE_RATE) + FW_FEE_FIXED_CENTS;
      return net - cost - fee;
    };
    const orderMarginPct = (o) => {
      const profit = orderProfitCents(o);
      const gross = o.amount_cents || 0;
      if (profit === null || gross <= 0) return null;
      return (profit / gross) * 100;
    };

    const sumProfit = (list) => list.reduce((s, o) => s + (orderProfitCents(o) || 0), 0);
    const totalProfit = sumProfit(orders);
    const prevProfit = sumProfit(prevOrders);

    // Overall margin = total profit / total gross. Track the previous-period
    // delta in percentage points so the KPI shows e.g. "+2.3pp" rather than a
    // pct-change-of-a-percentage.
    const overallMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
    const prevMargin = prevRevenue > 0 ? (prevProfit / prevRevenue) * 100 : 0;
    const marginDelta = overallMargin - prevMargin;

    // Daily revenue for trend chart (keep in cents for TrendChart, convert in tooltips)
    const dailyMap = {};
    for (const o of orders) {
      if (!o.occurred_at) continue;
      const d = ptDayKey(o.occurred_at);   // PT calendar day, not UTC slice
      if (!dailyMap[d]) dailyMap[d] = { date: d, gross: 0, net: 0, orders: 0 };
      dailyMap[d].gross += (o.amount_cents || 0) / 100;
      dailyMap[d].net += (o.net_amount_cents || 0) / 100;
      dailyMap[d].orders += 1;
    }
    const dailyRevenue = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

    // Top products. `hasCostData` flags whether the rows came from items[]
    // (so margin can be computed) vs. legacy aggregate orders (where we only
    // have gross + Fourthwall-net).
    const productMap = {};
    for (const o of orders) {
      const items = o.metadata?.items || [];
      if (items.length === 0) {
        const name = o.product_name || 'Fourthwall Order';
        if (!productMap[name]) productMap[name] = { name, orders: 0, gross: 0, net: 0, profit: 0, hasCostData: false };
        productMap[name].orders++;
        productMap[name].gross += (o.amount_cents || 0);
        productMap[name].net += (o.net_amount_cents || 0);
      } else {
        for (const item of items) {
          const name = item.name || 'Unknown';
          if (!productMap[name]) productMap[name] = { name, orders: 0, gross: 0, net: 0, profit: 0, hasCostData: true };
          else productMap[name].hasCostData = true;
          productMap[name].orders += item.quantity || 1;
          productMap[name].gross += (item.unit_price || 0) * (item.quantity || 1) * 100;
          const profit = ((item.unit_price || 0) - (item.unit_cost || 0)) * (item.quantity || 1) * 100;
          productMap[name].profit += profit;
          productMap[name].net += profit;
        }
      }
    }
    const topProducts = Object.values(productMap).sort((a, b) => b.gross - a.gross);

    return (
      <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: fwColor }} />
          <span style={{ fontSize: 18, fontWeight: 700, color: '#e7ebf2' }}>Merchandise</span>
        </div>

        {/* KPI Cards */}
        <div style={styles.kpiGrid}>
          <KPICard label="Orders" value={orders.length.toLocaleString()} change={pctChange(orders.length, prevOrders.length)} color={fwColor} />
          <KPICard label="Gross Revenue" value={formatCurrency(totalRevenue)} change={pctChange(totalRevenue, prevRevenue)} color="#f59e0b" />
          <KPICard label="Net Revenue" value={formatCurrency(netRevenue)} change={pctChange(netRevenue, prevNet)} color="#22c55e" />
          <KPICard label="Profit" value={formatCurrency(totalProfit)} change={pctChange(totalProfit, prevProfit)} color="#10b981" />
          <KPICard
            label="Margin"
            value={`${overallMargin.toFixed(1)}%`}
            change={pctChange(overallMargin, prevMargin)}
            changeLabel={`${marginDelta >= 0 ? '+' : ''}${marginDelta.toFixed(1)}pp vs prior`}
            color="#84cc16"
          />
          <KPICard label="Avg Order" value={formatCurrency(avgOrder)} change={pctChange(avgOrder, prevAvg)} color="#3b82f6" />
        </div>

        {/* Daily Revenue Trend */}
        {dailyRevenue.length > 0 && (
          <div style={{ ...styles.chartSection, width: '100%' }}>
            <div style={styles.chartHeader}>
              <span style={styles.chartTitle}>Revenue Over Time</span>
              <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                {[{ label: 'Gross', color: fwColor }, { label: 'Net', color: '#22c55e' }].map(m => (
                  <div key={m.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: m.color }} />
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', fontWeight: 500 }}>{m.label}</span>
                  </div>
                ))}
              </div>
            </div>
            <TrendChart
              data={dailyRevenue}
              metrics={[
                { key: 'gross', label: 'Gross', color: fwColor, getValue: r => r.gross },
                { key: 'net', label: 'Net', color: '#22c55e', getValue: r => r.net },
              ]}
            />
          </div>
        )}

        {/* Top Products */}
        {topProducts.length > 0 && (
          <div style={styles.chartSection}>
            <span style={styles.chartTitle}>Top Products</span>
            <div style={{ ...styles.tableWrap, marginTop: 12 }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Product</th>
                    <th style={{ ...styles.th, textAlign: 'right' }}>Units Sold</th>
                    <th style={{ ...styles.th, textAlign: 'right' }}>Gross</th>
                    <th style={{ ...styles.th, textAlign: 'right' }}>Net</th>
                  </tr>
                </thead>
                <tbody>
                  {topProducts.map((p, i) => (
                    <tr key={i} style={i % 2 === 0 ? styles.trEven : {}}>
                      <td style={styles.td}>{p.name}</td>
                      <td style={{ ...styles.td, textAlign: 'right' }}>{p.orders}</td>
                      <td style={{ ...styles.td, textAlign: 'right' }}>{formatCurrency(p.gross)}</td>
                      <td style={{ ...styles.td, textAlign: 'right' }}>{formatCurrency(p.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Recent Orders */}
        {orders.length > 0 && (
          <div style={styles.chartSection}>
            <span style={styles.chartTitle}>Recent Orders</span>
            <div style={{ ...styles.tableWrap, marginTop: 12 }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Order</th>
                    <th style={styles.th}>Products</th>
                    <th style={styles.th}>Date</th>
                    <th style={{ ...styles.th, textAlign: 'right' }}>Gross</th>
                    <th style={{ ...styles.th, textAlign: 'right' }}>Net</th>
                    <th style={{ ...styles.th, textAlign: 'right' }}>Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.slice(0, 50).map((o, i) => {
                    const margin = orderMarginPct(o);
                    return (
                      <tr key={o.id || i} style={i % 2 === 0 ? styles.trEven : {}}>
                        <td style={{ ...styles.td, color: 'rgba(255,255,255,0.42)', fontSize: 11 }}>{o.metadata?.friendly_id || '—'}</td>
                        <td style={{ ...styles.td, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.product_name || '—'}</td>
                        <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{o.occurred_at ? new Date(o.occurred_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td>
                        <td style={{ ...styles.td, textAlign: 'right' }}>{formatCurrency(o.amount_cents || 0)}</td>
                        <td style={{ ...styles.td, textAlign: 'right' }}>{formatCurrency(o.net_amount_cents || 0)}</td>
                        <td style={{ ...styles.td, textAlign: 'right' }}>{margin !== null ? `${margin.toFixed(1)}%` : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {orders.length === 0 && (
          <div style={styles.emptyCard}>
            <p style={styles.emptyText}>No orders found in the selected period.</p>
          </div>
        )}
      </>
    );
  }

  // Trend data
  const trendMetrics = [
    { key: 'views', label: 'Views', color: '#6366f1', getValue: r => Number(r.total_views) || 0 },
    { key: 'likes', label: 'Likes', color: '#ec4899', getValue: r => Number(r.total_likes) || 0 },
  ];

  // Follower trend
  const followerTrend = platData.audience.map(a => ({ date: a.date, followers: a.followers_total }));

  return (
    <>
      {/* Platform header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <span style={{ width: 12, height: 12, borderRadius: '50%', background: color }} />
        <span style={{ fontSize: 18, fontWeight: 700, color: '#e7ebf2' }}>{String(account?.account_name || '')}</span>
      </div>

      {/* KPI Cards */}
      <div style={styles.kpiGrid}>
        <KPICard label="Views" value={formatCompact(totalViews)} change={pctChange(totalViews, prevViews)} color={color} />
        {isYouTube && <KPICard label="Impressions" value={formatCompact(totalImpressions)} change={pctChange(totalImpressions, prevImpressions)} color="#f59e0b" />}
        <KPICard label="Engagement" value={formatCompact(totalEngagement)} change={pctChange(totalEngagement, prevEngagement)} color="#22c55e" />
        <KPICard label="Followers" value={formatCompact(latestFollowers)} change={pctChange(latestFollowers, prevFollowers)}
          changeLabel={`${followersGained >= 0 ? '+' : ''}${followersGained.toLocaleString()} this period`} color="#3b82f6" />
      </div>

      {/* Impressions Trend (YouTube only) */}
      {isYouTube && platData.ytDaily && platData.ytDaily.length > 0 && (
        <div style={{ ...styles.chartSection, width: '100%' }}>
          <div style={styles.chartHeader}>
            <span style={styles.chartTitle}>Impressions</span>
            <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f59e0b', flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', fontWeight: 500 }}>Impressions</span>
              </div>
            </div>
          </div>
          <TrendChart data={platData.ytDaily} metrics={[{ key: 'impressions', label: 'Impressions', color: '#f59e0b', getValue: r => Number(r.impressions) || 0 }]} />
        </div>
      )}

      {/* Views & Likes Trend */}
      {platData.rollups.length > 0 && (
        <div style={{ ...styles.chartSection, width: '100%' }}>
          <div style={styles.chartHeader}>
            <span style={styles.chartTitle}>Views & Likes</span>
            <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
              {trendMetrics.map(m => (
                <div key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: m.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', fontWeight: 500 }}>{m.label}</span>
                </div>
              ))}
            </div>
          </div>
          <TrendChart data={platData.rollups} metrics={trendMetrics} />
        </div>
      )}

      {/* Follower Trend */}
      {followerTrend.length > 1 && (
        <div style={{ ...styles.chartSection, width: '100%' }}>
          <span style={styles.chartTitle}>Followers</span>
          <TrendChart data={followerTrend} metrics={[{ key: 'followers', label: 'Followers', color: '#3b82f6', getValue: r => r.followers || 0 }]} />
        </div>
      )}

      {/* Content Table */}
      {sortedContent.length > 0 && (
        <div style={styles.chartSection}>
          <span style={styles.chartTitle}>Content ({sortedContent.length})</span>
          <div style={{ ...styles.tableWrap, marginTop: 12 }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Title</th>
                  <th style={{ ...styles.th, cursor: 'pointer' }} onClick={() => handleSort('published_at')}>
                    Date {sortCol === 'published_at' && <span style={styles.sortArrow}>{sortDir === 'asc' ? '↑' : '↓'}</span>}
                  </th>
                  <th style={{ ...styles.th, textAlign: 'right', cursor: 'pointer' }} onClick={() => handleSort('views')}>
                    Views {sortCol === 'views' && <span style={styles.sortArrow}>{sortDir === 'asc' ? '↑' : '↓'}</span>}
                  </th>
                  <th style={{ ...styles.th, textAlign: 'right', cursor: 'pointer' }} onClick={() => handleSort('likes')}>
                    Likes {sortCol === 'likes' && <span style={styles.sortArrow}>{sortDir === 'asc' ? '↑' : '↓'}</span>}
                  </th>
                  <th style={{ ...styles.th, textAlign: 'right', cursor: 'pointer' }} onClick={() => handleSort('engagement_rate')}>
                    Eng. {sortCol === 'engagement_rate' && <span style={styles.sortArrow}>{sortDir === 'asc' ? '↑' : '↓'}</span>}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedContent.map((c, i) => (
                  <tr key={c.id || i} style={i % 2 === 0 ? styles.trEven : {}}>
                    <td style={{ ...styles.td, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.url ? <a href={c.url} target="_blank" rel="noreferrer" style={{ color: color, textDecoration: 'none' }}>{String(c.title || '(No title)')}</a> : String(c.title || '(No title)')}
                    </td>
                    <td style={styles.td}>{c.published_at ? new Date(c.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}</td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>{formatCompact(Number(c.metrics?.views) || 0)}</td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>{formatCompact(Number(c.metrics?.likes) || 0)}</td>
                    <td style={{ ...styles.td, textAlign: 'right' }}>{c.metrics?.engagement_rate ? (Number(c.metrics.engagement_rate) * 100).toFixed(2) + '%' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {platData.rollups.length === 0 && sortedContent.length === 0 && (
        <div style={styles.emptyCard}>
          <p style={styles.emptyText}>No data found for this platform in the selected period.</p>
        </div>
      )}
    </>
  );
}

export default function PlatformViewSafe(props) {
  return <PlatformViewErrorBoundary key={props.accountId}><PlatformView {...props} /></PlatformViewErrorBoundary>;
}
