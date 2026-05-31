import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';

// Tiller expense categories the sync writes into expense_transactions. Must
// stay aligned with EXPENSE_CATEGORIES in supabase/functions/sync-tiller.
const EXPENSE_CATEGORY_META = {
  'Employees':              { label: 'Employees',           color: '#6366f1' },
  'Rent & Utilities':       { label: 'Rent & Utilities',    color: '#3b82f6' },
  'Equipment':              { label: 'Equipment',           color: '#0ea5e9' },
  'Equipment - Neptune':    { label: 'Equipment (Neptune)', color: '#06b6d4' },
  'R&D/Production':         { label: 'R&D / Production',    color: '#14b8a6' },
  'Travel':                 { label: 'Travel',              color: '#22c55e' },
  'Admin Subscriptions':    { label: 'Admin Subs',          color: '#84cc16' },
  'Creative Subscriptions': { label: 'Creative Subs',       color: '#eab308' },
  'Insurance':              { label: 'Insurance',           color: '#f59e0b' },
  'Freelancers':            { label: 'Freelancers',         color: '#f97316' },
  'Misc Expense':           { label: 'Misc',                color: '#ef4444' },
  'Administration':         { label: 'Administration',      color: '#ec4899' },
  'Supplies':               { label: 'Supplies',            color: '#d946ef' },
  'Entertainment/Fun':      { label: 'Entertainment',       color: '#a855f7' },
  'Medical':                { label: 'Medical',             color: '#8b5cf6' },
  'Food':                   { label: 'Food',                color: '#64748b' },
  'Bank Fees':              { label: 'Bank Fees',           color: '#94a3b8' },
  'Taxes':                  { label: 'Taxes',               color: '#475569' },
};

const DATE_RANGES = [
  { key: '30d',  label: '30 days', days: 30 },
  { key: '90d',  label: '90 days', days: 90 },
  { key: 'ytd',  label: 'YTD' },
  { key: '1y',   label: '1 year', days: 365 },
  { key: 'all',  label: 'All time' },
];

function getRange(rangeKey) {
  const today = new Date();
  const end = today.toISOString().slice(0, 10);
  if (rangeKey === 'all')  return { start: '2000-01-01', end };
  if (rangeKey === 'ytd')  return { start: `${today.getFullYear()}-01-01`, end };
  const def = DATE_RANGES.find(r => r.key === rangeKey);
  const start = new Date(today.getTime() - (def?.days || 30) * 86400000).toISOString().slice(0, 10);
  return { start, end };
}

function formatMoney(cents, opts = {}) {
  const dollars = (cents || 0) / 100;
  return '$' + dollars.toLocaleString(undefined, {
    minimumFractionDigits: opts.compact ? 0 : 2,
    maximumFractionDigits: opts.compact ? 0 : 2,
  });
}

function monthKey(dateStr) {
  return dateStr?.slice(0, 7) || '';
}

export default function Expenses() {
  const { isAdmin } = useAuth();
  const [rangeKey, setRangeKey] = useState('90d');
  const [data, setData] = useState([]);
  const [prevData, setPrevData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [sortBy, setSortBy] = useState('date_desc');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const { start, end } = getRange(rangeKey);
      const daysDiff = Math.max(1, Math.ceil((new Date(end) - new Date(start)) / 86400000));
      const prevStart = new Date(new Date(start).getTime() - daysDiff * 86400000).toISOString().slice(0, 10);

      const [{ data: cur }, { data: prev }] = await Promise.all([
        supabase
          .from('expense_transactions')
          .select('date, description, category, amount_cents, account')
          .gte('date', start)
          .lte('date', end)
          .order('date', { ascending: false }),
        supabase
          .from('expense_transactions')
          .select('amount_cents')
          .gte('date', prevStart)
          .lt('date', start),
      ]);

      if (!cancelled) {
        setData(cur || []);
        setPrevData(prev || []);
        setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [rangeKey]);

  const totals = useMemo(() => {
    const total = data.reduce((s, t) => s + t.amount_cents, 0);
    const prevTotal = prevData.reduce((s, t) => s + t.amount_cents, 0);
    const delta = prevTotal === 0 ? null : ((total - prevTotal) / prevTotal) * 100;
    return { total, prevTotal, delta };
  }, [data, prevData]);

  const byCategory = useMemo(() => {
    const map = {};
    for (const tx of data) {
      const meta = EXPENSE_CATEGORY_META[tx.category];
      const label = meta?.label || tx.category;
      const color = meta?.color || '#71717a';
      if (!map[tx.category]) map[tx.category] = { category: tx.category, label, color, total: 0, count: 0 };
      map[tx.category].total += tx.amount_cents;
      map[tx.category].count += 1;
    }
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [data]);

  const byMonth = useMemo(() => {
    const map = {};
    for (const tx of data) {
      const m = monthKey(tx.date);
      if (!m) continue;
      map[m] = (map[m] || 0) + tx.amount_cents;
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([month, total]) => ({ month, total }));
  }, [data]);

  const maxMonth = Math.max(1, ...byMonth.map(m => m.total));
  const topCategory = byCategory[0] || null;

  const filteredRows = useMemo(() => {
    let rows = data;
    if (categoryFilter !== 'all') rows = rows.filter(t => t.category === categoryFilter);
    if (search.trim()) {
      const needle = search.toLowerCase();
      rows = rows.filter(t =>
        (t.description || '').toLowerCase().includes(needle)
        || (t.category || '').toLowerCase().includes(needle)
        || (t.account || '').toLowerCase().includes(needle)
      );
    }
    const sorted = [...rows];
    sorted.sort((a, b) => {
      switch (sortBy) {
        case 'date_asc':    return a.date.localeCompare(b.date);
        case 'amount_desc': return b.amount_cents - a.amount_cents;
        case 'amount_asc':  return a.amount_cents - b.amount_cents;
        case 'category':    return (a.category || '').localeCompare(b.category || '');
        case 'date_desc':
        default:            return b.date.localeCompare(a.date);
      }
    });
    return sorted;
  }, [data, search, categoryFilter, sortBy]);

  if (!isAdmin) {
    return (
      <div style={styles.page}>
        <h1 style={styles.title}>Expenses</h1>
        <p style={styles.emptyText}>Admins only.</p>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Expenses</h1>
        <div style={styles.rangeBar}>
          {DATE_RANGES.map(r => (
            <button
              key={r.key}
              onClick={() => setRangeKey(r.key)}
              style={{
                ...styles.rangePill,
                ...(rangeKey === r.key ? styles.rangePillActive : {}),
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p style={styles.emptyText}>Loading expenses…</p>
      ) : data.length === 0 ? (
        <p style={styles.emptyText}>No expenses in this range.</p>
      ) : (
        <>
          {/* KPI row */}
          <div style={styles.kpiRow}>
            <KpiCard
              label="Total expenses"
              value={formatMoney(totals.total)}
              delta={totals.delta}
              accent="#ef4444"
            />
            <KpiCard
              label="Transactions"
              value={data.length.toLocaleString()}
              accent="#3b82f6"
            />
            <KpiCard
              label="Top category"
              value={topCategory ? topCategory.label : '—'}
              sub={topCategory ? formatMoney(topCategory.total) : ''}
              accent={topCategory?.color || '#71717a'}
            />
            <KpiCard
              label="Avg per transaction"
              value={formatMoney(data.length ? Math.round(totals.total / data.length) : 0)}
              accent="#a855f7"
            />
          </div>

          {/* Charts row */}
          <div style={styles.chartsRow}>
            {/* By category */}
            <div style={styles.chartCard}>
              <div style={styles.chartTitle}>By Category</div>
              <div style={styles.catList}>
                {byCategory.map(c => {
                  const pct = totals.total > 0 ? (c.total / totals.total) * 100 : 0;
                  return (
                    <div key={c.category} style={styles.catRow}>
                      <div style={styles.catRowHeader}>
                        <span style={styles.catLabel}>
                          <span style={{ ...styles.catSwatch, background: c.color }} />
                          {c.label}
                        </span>
                        <span style={styles.catTotal}>{formatMoney(c.total)}</span>
                      </div>
                      <div style={styles.catBarTrack}>
                        <div style={{ ...styles.catBarFill, width: `${pct}%`, background: c.color }} />
                      </div>
                      <div style={styles.catRowMeta}>
                        <span>{c.count} tx</span>
                        <span>{pct.toFixed(1)}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Monthly trend */}
            <div style={styles.chartCard}>
              <div style={styles.chartTitle}>Monthly Trend</div>
              {byMonth.length === 0 ? (
                <p style={styles.emptyText}>Not enough data.</p>
              ) : (
                <div style={styles.monthList}>
                  {byMonth.map(m => {
                    const pct = maxMonth > 0 ? (m.total / maxMonth) * 100 : 0;
                    return (
                      <div key={m.month} style={styles.monthRow}>
                        <span style={styles.monthLabel}>{m.month}</span>
                        <div style={styles.monthBarTrack}>
                          <div style={{ ...styles.monthBarFill, width: `${pct}%` }} />
                        </div>
                        <span style={styles.monthTotal}>{formatMoney(m.total, { compact: true })}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Table */}
          <div style={styles.tableCard}>
            <div style={styles.tableHeader}>
              <span style={styles.tableTitle}>Transactions ({filteredRows.length})</span>
              <div style={styles.tableControls}>
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  style={styles.control}
                >
                  <option value="all">All categories</option>
                  {byCategory.map(c => (
                    <option key={c.category} value={c.category}>{c.label}</option>
                  ))}
                </select>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  style={styles.control}
                >
                  <option value="date_desc">Newest first</option>
                  <option value="date_asc">Oldest first</option>
                  <option value="amount_desc">Largest first</option>
                  <option value="amount_asc">Smallest first</option>
                  <option value="category">By category</option>
                </select>
                <input
                  type="search"
                  placeholder="Search description, category, account…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{ ...styles.control, flex: 1, minWidth: 200 }}
                />
              </div>
            </div>
            <div style={styles.tableScroll}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Date</th>
                    <th style={styles.th}>Category</th>
                    <th style={styles.th}>Description</th>
                    <th style={styles.th}>Account</th>
                    <th style={{ ...styles.th, textAlign: 'right' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((t, i) => {
                    const meta = EXPENSE_CATEGORY_META[t.category];
                    return (
                      <tr key={`${t.date}-${i}`} style={styles.tr}>
                        <td style={styles.td}>{t.date}</td>
                        <td style={styles.td}>
                          <span style={{
                            ...styles.catChip,
                            background: (meta?.color || '#71717a') + '22',
                            color: meta?.color || '#a3a3a3',
                            borderColor: (meta?.color || '#71717a') + '55',
                          }}>
                            {meta?.label || t.category}
                          </span>
                        </td>
                        <td style={{ ...styles.td, color: 'rgba(255,255,255,0.85)' }}>{t.description || '—'}</td>
                        <td style={{ ...styles.td, color: 'rgba(255,255,255,0.55)' }}>{t.account || '—'}</td>
                        <td style={{ ...styles.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {formatMoney(t.amount_cents)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function KpiCard({ label, value, sub, delta, accent }) {
  return (
    <div style={{ ...styles.kpiCard, borderLeft: `3px solid ${accent || '#6366f1'}` }}>
      <div style={styles.kpiLabel}>{label}</div>
      <div style={styles.kpiValue}>{value}</div>
      {sub && <div style={styles.kpiSub}>{sub}</div>}
      {delta != null && (
        <div style={{
          ...styles.kpiDelta,
          color: delta > 0 ? '#f87171' : '#4ade80',
        }}>
          {delta > 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}% vs prior period
        </div>
      )}
    </div>
  );
}

const styles = {
  page: {
    padding: '28px 32px',
    background: '#0f0f1a',
    minHeight: '100%',
    color: '#fff',
    fontFamily: 'inherit',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 22,
    flexWrap: 'wrap',
    gap: 12,
  },
  title: {
    fontSize: 26,
    fontWeight: 700,
    margin: 0,
    letterSpacing: -0.5,
  },
  rangeBar: {
    display: 'flex',
    gap: 6,
  },
  rangePill: {
    padding: '6px 12px',
    fontSize: 12,
    borderRadius: 6,
    background: 'rgba(255,255,255,0.04)',
    color: 'rgba(255,255,255,0.6)',
    border: '1px solid rgba(255,255,255,0.08)',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  rangePillActive: {
    background: 'rgba(99,102,241,0.18)',
    color: '#fff',
    borderColor: 'rgba(99,102,241,0.5)',
  },
  emptyText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 14,
  },

  kpiRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 12,
    marginBottom: 18,
  },
  kpiCard: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 10,
    padding: '14px 16px',
  },
  kpiLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.45)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  kpiValue: {
    fontSize: 22,
    fontWeight: 700,
    color: '#fff',
  },
  kpiSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.55)',
    marginTop: 2,
  },
  kpiDelta: {
    fontSize: 11,
    marginTop: 6,
  },

  chartsRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
    gap: 12,
    marginBottom: 18,
  },
  chartCard: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 10,
    padding: 16,
  },
  chartTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.85)',
    marginBottom: 12,
  },

  catList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    maxHeight: 360,
    overflowY: 'auto',
  },
  catRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  catRowHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 12,
  },
  catLabel: {
    color: 'rgba(255,255,255,0.85)',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  },
  catSwatch: {
    width: 8,
    height: 8,
    borderRadius: 2,
    display: 'inline-block',
  },
  catTotal: {
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
  },
  catBarTrack: {
    height: 6,
    background: 'rgba(255,255,255,0.05)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  catBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  catRowMeta: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 10,
    color: 'rgba(255,255,255,0.35)',
  },

  monthList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  monthRow: {
    display: 'grid',
    gridTemplateColumns: '60px 1fr 80px',
    alignItems: 'center',
    gap: 10,
    fontSize: 12,
  },
  monthLabel: {
    color: 'rgba(255,255,255,0.55)',
    fontVariantNumeric: 'tabular-nums',
  },
  monthBarTrack: {
    height: 8,
    background: 'rgba(255,255,255,0.05)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  monthBarFill: {
    height: '100%',
    background: '#ef4444',
    borderRadius: 4,
  },
  monthTotal: {
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
    color: 'rgba(255,255,255,0.85)',
  },

  tableCard: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 10,
    padding: 16,
  },
  tableHeader: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    marginBottom: 10,
  },
  tableTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.85)',
  },
  tableControls: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
  },
  control: {
    background: 'rgba(255,255,255,0.04)',
    color: '#fff',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 6,
    padding: '6px 10px',
    fontSize: 12,
    fontFamily: 'inherit',
  },
  tableScroll: {
    overflowX: 'auto',
    maxHeight: 540,
    overflowY: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 12,
  },
  th: {
    position: 'sticky',
    top: 0,
    background: 'rgba(15,15,26,0.95)',
    backdropFilter: 'blur(4px)',
    textAlign: 'left',
    padding: '8px 10px',
    color: 'rgba(255,255,255,0.45)',
    fontWeight: 500,
    textTransform: 'uppercase',
    fontSize: 10,
    letterSpacing: 0.5,
    borderBottom: '1px solid rgba(255,255,255,0.08)',
  },
  tr: {
    borderBottom: '1px solid rgba(255,255,255,0.04)',
  },
  td: {
    padding: '8px 10px',
    color: 'rgba(255,255,255,0.7)',
    fontVariantNumeric: 'tabular-nums',
  },
  catChip: {
    padding: '2px 8px',
    borderRadius: 4,
    border: '1px solid',
    fontSize: 11,
    fontWeight: 500,
    whiteSpace: 'nowrap',
  },
};
