import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../../../supabaseClient';
import { PLATFORM_META } from '../constants';
import { todayStr, daysAgoStr, pctChange, formatCompact, formatCurrency, fetchAllRows } from '../utils';
import { styles } from '../styles';

// ── Comparison time presets ──
// Each builds a { current, previous } pair of { start, end, label } windows.
// "current" is always compared against an equal-length window immediately
// preceding it (or the same calendar span a year earlier, for YTD).
const COMPARE_PRESETS = [
  { key: '30d', label: '30d vs prev' },
  { key: '60d', label: '60d vs prev' },
  { key: '90d', label: '90d vs prev' },
  { key: 'ytd', label: 'YTD vs last year' },
  { key: 'custom', label: 'Custom' },
];

const METRICS = [
  { key: 'views',      label: 'Views',      color: '#6366f1', format: v => formatCompact(v) },
  { key: 'engagement', label: 'Engagement', color: '#22c55e', format: v => formatCompact(v) },
  { key: 'followers',  label: 'Net Followers', color: '#ec4899', format: v => (v >= 0 ? '+' : '') + formatCompact(v) },
  { key: 'revenue',    label: 'Revenue',    color: '#f59e0b', format: v => formatCurrency(v) },
];

// ── Date helpers (operate on 'YYYY-MM-DD' strings, UTC-anchored to avoid TZ drift) ──
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysInclusive(start, end) {
  return Math.round((new Date(end + 'T00:00:00Z') - new Date(start + 'T00:00:00Z')) / 86400000) + 1;
}

function buildPeriods(preset, customStart, customEnd) {
  if (preset === 'ytd') {
    const today = todayStr();
    const [y, m, d] = today.split('-');
    const prevYear = String(Number(y) - 1);
    // Guard the Feb-29 edge: last year may not have it.
    const prevMD = (m === '02' && d === '29') ? '02-28' : `${m}-${d}`;
    return {
      current: { start: `${y}-01-01`, end: today, label: `${y} YTD` },
      previous: { start: `${prevYear}-01-01`, end: `${prevYear}-${prevMD}`, label: `${prevYear} YTD` },
    };
  }
  if (preset === 'custom') {
    const start = customStart;
    const end = customEnd;
    const len = Math.max(1, daysInclusive(start, end));
    const prevEnd = addDays(start, -1);
    const prevStart = addDays(prevEnd, -(len - 1));
    return {
      current: { start, end, label: 'Custom' },
      previous: { start: prevStart, end: prevEnd, label: 'Previous period' },
    };
  }
  // Rolling N-day presets.
  const n = Number(preset.replace('d', ''));
  const end = todayStr();
  const start = daysAgoStr(n);
  return {
    current: { start, end, label: `Last ${n} days` },
    previous: { start: daysAgoStr(2 * n + 1), end: daysAgoStr(n + 1), label: `Previous ${n} days` },
  };
}

function fmtShort(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

// ── Aggregate rollup rows into per-account metric totals + daily series ──
function aggregate(rows) {
  const byAcct = {};
  for (const r of rows) {
    const id = r.platform_account_id;
    if (!byAcct[id]) {
      byAcct[id] = {
        id, platform: r.platform, name: r.account_name,
        views: 0, engagement: 0, followers: 0, revenue: 0, posts: 0,
        _daily: {},
      };
    }
    const a = byAcct[id];
    const views = Number(r.total_views) || 0;
    const eng = (Number(r.total_likes) || 0) + (Number(r.total_comments) || 0) + (Number(r.total_shares) || 0);
    const fol = Number(r.followers_gained) || 0;
    const rev = Number(r.revenue_cents) || 0;
    a.views += views; a.engagement += eng; a.followers += fol; a.revenue += rev;
    a.posts += Number(r.posts_published) || 0;
    const day = String(r.date).slice(0, 10);
    if (!a._daily[day]) a._daily[day] = { views: 0, engagement: 0, followers: 0, revenue: 0 };
    a._daily[day].views += views;
    a._daily[day].engagement += eng;
    a._daily[day].followers += fol;
    a._daily[day].revenue += rev;
  }
  // Freeze daily into sorted arrays per metric for sparklines.
  for (const a of Object.values(byAcct)) {
    const days = Object.keys(a._daily).sort();
    a.series = {};
    for (const m of METRICS) a.series[m.key] = days.map(d => a._daily[d][m.key]);
    delete a._daily;
  }
  return byAcct;
}

// ── Tiny inline sparkline ──
function Sparkline({ values, color, width = 72, height = 20 }) {
  if (!values || values.length < 2) return <div style={{ width, height }} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = width / (values.length - 1);
  const pts = values
    .map((v, i) => `${(i * step).toFixed(1)},${(height - ((v - min) / range) * height).toFixed(1)}`)
    .join(' ');
  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5"
        strokeLinejoin="round" strokeLinecap="round" opacity={0.85} />
    </svg>
  );
}

function DeltaBadge({ cur, prev }) {
  if (cur === 0 && prev === 0) return <span style={local.deltaFlat}>—</span>;
  const pct = pctChange(cur, prev);
  const up = cur >= prev;
  const color = cur === prev ? '#8791a0' : up ? '#22c55e' : '#ef4444';
  const arrow = cur === prev ? '' : up ? '▲' : '▼';
  return (
    <span style={{ ...local.deltaBadge, color }}>
      {arrow} {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
    </span>
  );
}

function MetricCell({ metric, cur, prev, series }) {
  return (
    <td style={styles.td}>
      <div style={local.cellValue}>{metric.format(cur)}</div>
      <Sparkline values={series} color={metric.color} />
      <div style={local.cellFooter}>
        <DeltaBadge cur={cur} prev={prev} />
        <span style={local.cellPrev}>vs {metric.format(prev)}</span>
      </div>
    </td>
  );
}

// Efficiency cell: views per post (cur vs prev), no sparkline — a ratio's daily
// series is too noisy to read at this size.
function EfficiencyCell({ curViews, curPosts, prevViews, prevPosts }) {
  const cur = curPosts > 0 ? curViews / curPosts : 0;
  const prev = prevPosts > 0 ? prevViews / prevPosts : 0;
  return (
    <td style={styles.td}>
      <div style={local.cellValue}>{curPosts > 0 ? formatCompact(cur) : '—'}</div>
      <div style={{ ...local.cellPrev, marginBottom: 3 }}>{curPosts} posts</div>
      <div style={local.cellFooter}>
        <DeltaBadge cur={cur} prev={prev} />
        <span style={local.cellPrev}>vs {prevPosts > 0 ? formatCompact(prev) : '—'}</span>
      </div>
    </td>
  );
}

export default function CompareView({ accounts = [] }) {
  const [preset, setPreset] = useState('30d');
  const [customStart, setCustomStart] = useState(daysAgoStr(30));
  const [customEnd, setCustomEnd] = useState(todayStr());
  const [selectedIds, setSelectedIds] = useState([]); // empty = all
  const [curAgg, setCurAgg] = useState({});
  const [prevAgg, setPrevAgg] = useState({});
  const [loading, setLoading] = useState(true);
  const genRef = useRef(0);

  const periods = useMemo(
    () => buildPeriods(preset, customStart, customEnd),
    [preset, customStart, customEnd],
  );

  const fetchData = useCallback(async () => {
    const gen = ++genRef.current;
    setLoading(true);
    try {
      const cols = 'date, platform_account_id, platform, account_name, total_views, total_likes, total_comments, total_shares, followers_gained, revenue_cents, posts_published';
      const baseQuery = (p) => {
        let q = supabase
          .from('daily_platform_rollups')
          .select(cols)
          .gte('date', p.start)
          .lte('date', p.end);
        if (selectedIds.length > 0) q = q.in('platform_account_id', selectedIds);
        return q;
      };
      const [curRows, prevRows] = await Promise.all([
        fetchAllRows(baseQuery(periods.current)),
        fetchAllRows(baseQuery(periods.previous)),
      ]);
      if (gen !== genRef.current) return;
      setCurAgg(aggregate(curRows));
      setPrevAgg(aggregate(prevRows));
    } catch (err) {
      console.error('Compare fetch error:', err);
    } finally {
      if (gen === genRef.current) setLoading(false);
    }
  }, [periods, selectedIds]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Rows: every account with data in either period, sorted by current views.
  const rows = useMemo(() => {
    const ids = new Set([...Object.keys(curAgg), ...Object.keys(prevAgg)]);
    const out = [];
    for (const id of ids) {
      const cur = curAgg[id];
      const prev = prevAgg[id];
      const ref = cur || prev;
      out.push({
        id,
        platform: ref.platform,
        name: ref.name,
        posts: { cur: cur ? cur.posts : 0, prev: prev ? prev.posts : 0 },
        metrics: METRICS.reduce((acc, m) => {
          acc[m.key] = {
            cur: cur ? cur[m.key] : 0,
            prev: prev ? prev[m.key] : 0,
            series: cur ? cur.series[m.key] : [],
          };
          return acc;
        }, {}),
      });
    }
    return out.sort((a, b) => b.metrics.views.cur - a.metrics.views.cur);
  }, [curAgg, prevAgg]);

  // All-platforms total row.
  const totals = useMemo(() => {
    const t = {};
    for (const m of METRICS) {
      const cur = rows.reduce((s, r) => s + r.metrics[m.key].cur, 0);
      const prev = rows.reduce((s, r) => s + r.metrics[m.key].prev, 0);
      // Combine daily series by index position across platforms.
      const maxLen = Math.max(0, ...rows.map(r => r.metrics[m.key].series.length));
      const series = Array.from({ length: maxLen }, (_, i) =>
        rows.reduce((s, r) => s + (r.metrics[m.key].series[i] || 0), 0));
      t[m.key] = { cur, prev, series };
    }
    t.posts = {
      cur: rows.reduce((s, r) => s + r.posts.cur, 0),
      prev: rows.reduce((s, r) => s + r.posts.prev, 0),
    };
    return t;
  }, [rows]);

  function toggleAccount(id) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  return (
    <div>
      {/* ── Period preset selector ── */}
      <div style={local.controlBar}>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
          {COMPARE_PRESETS.map(p => (
            <button key={p.key} onClick={() => setPreset(p.key)}
              style={{ ...styles.filterChip, ...(preset === p.key ? styles.filterChipActive : {}) }}>
              {p.label}
            </button>
          ))}
          {preset === 'custom' && (
            <>
              <input type="date" value={customStart} max={customEnd}
                onChange={e => setCustomStart(e.target.value)} style={styles.filterInput} />
              <span style={{ color: '#8791a0' }}>to</span>
              <input type="date" value={customEnd} min={customStart} max={todayStr()}
                onChange={e => setCustomEnd(e.target.value)} style={styles.filterInput} />
            </>
          )}
        </div>
      </div>

      {/* ── Platform filter pills ── */}
      {accounts.length > 0 && (
        <div style={local.pillRow}>
          <button onClick={() => setSelectedIds([])}
            style={{ ...styles.filterChip, ...(selectedIds.length === 0 ? styles.filterChipActive : {}) }}>
            All platforms
          </button>
          {accounts.map(acct => {
            const meta = PLATFORM_META[acct.platform] || { color: '#666' };
            const active = selectedIds.includes(acct.id);
            return (
              <button key={acct.id} onClick={() => toggleAccount(acct.id)}
                style={{
                  ...styles.filterChip,
                  ...(active ? { background: meta.color + '22', borderColor: meta.color + '66', color: meta.color } : {}),
                  display: 'flex', alignItems: 'center', gap: '6px',
                }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: meta.color, flexShrink: 0 }} />
                {acct.account_name}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Compared windows summary ── */}
      <div style={local.rangeSummary}>
        <span style={{ color: '#a5b4fc', fontWeight: 600 }}>{periods.current.label}</span>
        <span style={local.rangeDates}>{fmtShort(periods.current.start)} – {fmtShort(periods.current.end)}</span>
        <span style={{ color: '#aab2be', margin: '0 4px' }}>vs</span>
        <span style={{ color: '#5a6473', fontWeight: 600 }}>{periods.previous.label}</span>
        <span style={local.rangeDates}>{fmtShort(periods.previous.start)} – {fmtShort(periods.previous.end)}</span>
      </div>

      {/* ── Matrix table ── */}
      {loading ? (
        <p style={styles.loadingText}>Loading comparison...</p>
      ) : rows.length === 0 ? (
        <div style={styles.emptyCard}><p style={styles.emptyText}>No data for the selected period.</p></div>
      ) : (
        <div style={styles.tableWrap}>
          <table style={{ ...styles.table, minWidth: '900px' }}>
            <thead>
              <tr>
                <th style={{ ...styles.th, ...styles.thSticky }}>Platform</th>
                {METRICS.map(m => (
                  <th key={m.key} style={{ ...styles.th, textAlign: 'left', minWidth: '150px' }}>
                    <span style={{ color: m.color }}>{m.label}</span>
                  </th>
                ))}
                <th style={{ ...styles.th, textAlign: 'left', minWidth: '130px' }} title="Views per post — reach earned per unit of work">
                  <span style={{ color: '#a5b4fc' }}>Views / Post</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {/* All-platforms total row */}
              <tr style={local.totalRow}>
                <td style={{ ...styles.td, ...styles.tdSticky, background: '#1a1a2e', fontWeight: 700, color: '#263043' }}>
                  All Platforms
                </td>
                {METRICS.map(m => (
                  <MetricCell key={m.key} metric={m}
                    cur={totals[m.key].cur} prev={totals[m.key].prev} series={totals[m.key].series} />
                ))}
                <EfficiencyCell curViews={totals.views.cur} curPosts={totals.posts.cur}
                  prevViews={totals.views.prev} prevPosts={totals.posts.prev} />
              </tr>
              {rows.map((row, i) => {
                const meta = PLATFORM_META[row.platform] || { label: row.platform, color: '#666' };
                return (
                  <tr key={row.id} style={i % 2 === 0 ? styles.trEven : {}}>
                    <td style={{ ...styles.td, ...styles.tdSticky, background: i % 2 === 0 ? '#15152a' : '#ffffff' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ width: 10, height: 10, borderRadius: '3px', background: meta.color, flexShrink: 0 }} />
                        <span>
                          <span style={{ color: '#263043', fontWeight: 600 }}>{row.name || meta.label}</span>
                          {row.name && row.name !== meta.label && (
                            <span style={{ display: 'block', fontSize: '10px', color: '#8791a0' }}>{meta.label}</span>
                          )}
                        </span>
                      </span>
                    </td>
                    {METRICS.map(m => (
                      <MetricCell key={m.key} metric={m}
                        cur={row.metrics[m.key].cur} prev={row.metrics[m.key].prev} series={row.metrics[m.key].series} />
                    ))}
                    <EfficiencyCell curViews={row.metrics.views.cur} curPosts={row.posts.cur}
                      prevViews={row.metrics.views.prev} prevPosts={row.posts.prev} />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const local = {
  controlBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '12px' },
  pillRow: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '12px' },
  rangeSummary: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', fontSize: '13px', marginBottom: '16px', padding: '10px 14px', background: 'rgba(38,48,67,0.03)', border: '1px solid rgba(38,48,67,0.08)', borderRadius: '10px' },
  rangeDates: { fontSize: '11px', color: '#8791a0' },
  totalRow: { background: 'rgba(99,102,241,0.06)', borderBottom: '2px solid rgba(99,102,241,0.25)' },
  cellValue: { fontSize: '15px', fontWeight: 700, color: '#263043', fontVariantNumeric: 'tabular-nums', marginBottom: '3px' },
  cellFooter: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '3px' },
  cellPrev: { fontSize: '10px', color: '#8791a0', fontVariantNumeric: 'tabular-nums' },
  deltaBadge: { fontSize: '11px', fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
  deltaFlat: { fontSize: '11px', color: '#8791a0' },
};
