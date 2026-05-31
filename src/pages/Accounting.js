import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { DonutChart, TrendChart, formatCompact } from '../lib/charts';

// Revenue (income) categories the Tiller sync writes into revenue_transactions.
// Mirrors INCOME_CATEGORIES + the meta map that used to live in Analytics.js.
const REVENUE_CATEGORY_META = {
  'YouTube Income':     { label: 'YouTube',      color: '#FF0000' },
  'TikTok Income':      { label: 'TikTok',       color: '#00F2EA' },
  'Twitch Income':      { label: 'Twitch',       color: '#9146FF' },
  'Substack Income':    { label: 'Substack',     color: '#FF6719' },
  'Sponsorship Income': { label: 'Sponsorships', color: '#10b981' },
  'Merch Income':       { label: 'Merch',        color: '#f97316' },
  'Facebook Income':    { label: 'Facebook',     color: '#1877F2' },
  'Services':           { label: 'Appearances',  color: '#f59e0b' },
};

// Expense categories. Must stay aligned with EXPENSE_CATEGORIES in
// supabase/functions/sync-tiller.
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

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'revenue',  label: 'Revenue' },
  { key: 'expenses', label: 'Expenses' },
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

function formatMoney(cents) {
  return '$' + ((cents || 0) / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

function monthKey(dateStr) {
  return dateStr?.slice(0, 7) || '';
}

function pctDelta(curr, prev) {
  if (prev === 0) return null;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

// ── Page ────────────────────────────────────────────────────────────────────
export default function Accounting() {
  const { isAdmin } = useAuth();
  const [rangeKey, setRangeKey] = useState('90d');
  const [tab, setTab] = useState('overview');

  const [revenue, setRevenue]       = useState([]);
  const [revenuePrev, setRevenuePrev] = useState([]);
  const [expenses, setExpenses]     = useState([]);
  const [expensesPrev, setExpensesPrev] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(null);

  const load = useCallback(async ({ signal } = {}) => {
    const { start, end } = getRange(rangeKey);
    const daysDiff = Math.max(1, Math.ceil((new Date(end) - new Date(start)) / 86400000));
    const prevStart = new Date(new Date(start).getTime() - daysDiff * 86400000).toISOString().slice(0, 10);

    const [revCur, revOld, expCur, expOld] = await Promise.all([
      supabase.from('revenue_transactions')
        .select('date, description, category, amount_cents, account')
        .gte('date', start).lte('date', end).order('date', { ascending: false }),
      supabase.from('revenue_transactions')
        .select('date, category, amount_cents')
        .gte('date', prevStart).lt('date', start),
      supabase.from('expense_transactions')
        .select('date, description, category, amount_cents, account')
        .gte('date', start).lte('date', end).order('date', { ascending: false }),
      supabase.from('expense_transactions')
        .select('date, category, amount_cents')
        .gte('date', prevStart).lt('date', start),
    ]);

    if (signal?.aborted) return;
    setRevenue(revCur.data || []);
    setRevenuePrev(revOld.data || []);
    setExpenses(expCur.data || []);
    setExpensesPrev(expOld.data || []);
  }, [rangeKey]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    load({ signal: controller.signal }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [load]);

  // Trigger the Tiller sync edge function to pull fresh transactions from the
  // Google Sheet into revenue_transactions / expense_transactions, then re-read
  // the tables for the current range.
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      const { error } = await supabase.functions.invoke('sync-tiller', { body: {} });
      if (error) throw error;
      await load();
    } catch (err) {
      setRefreshError(err?.message || 'Sync failed. Please try again.');
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  if (!isAdmin) {
    return (
      <div style={styles.page}>
        <h1 style={styles.title}>Accounting</h1>
        <p style={styles.emptyText}>Admins only.</p>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Accounting</h1>
        <div style={styles.headerControls}>
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
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing || loading}
            style={{
              ...styles.refreshBtn,
              ...(refreshing || loading ? styles.refreshBtnDisabled : {}),
            }}
            title="Sync transactions from Tiller"
          >
            <span style={{
              ...styles.refreshIcon,
              ...(refreshing ? styles.refreshIconSpin : {}),
            }}>↻</span>
            {refreshing ? 'Syncing…' : 'Sync Tiller'}
          </button>
        </div>
      </div>

      {refreshError && (
        <div style={styles.errorBanner}>{refreshError}</div>
      )}

      <div style={styles.tabBar}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              ...styles.tab,
              ...(tab === t.key ? styles.tabActive : {}),
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p style={styles.emptyText}>Loading…</p>
      ) : tab === 'overview' ? (
        <OverviewTab
          revenue={revenue} revenuePrev={revenuePrev}
          expenses={expenses} expensesPrev={expensesPrev}
        />
      ) : tab === 'revenue' ? (
        <LedgerTab
          mode="revenue"
          data={revenue} prevData={revenuePrev}
          meta={REVENUE_CATEGORY_META}
          accentColor="#22c55e"
          headlineLabel="Total revenue"
        />
      ) : (
        <LedgerTab
          mode="expense"
          data={expenses} prevData={expensesPrev}
          meta={EXPENSE_CATEGORY_META}
          accentColor="#ef4444"
          headlineLabel="Total expenses"
        />
      )}
    </div>
  );
}

// ── Overview Tab ────────────────────────────────────────────────────────────
function OverviewTab({ revenue, revenuePrev, expenses, expensesPrev }) {
  const [ledgerOpen, setLedgerOpen] = useState(false);

  const revTotal     = useMemo(() => revenue.reduce((s, t) => s + t.amount_cents, 0), [revenue]);
  const revPrevTotal = useMemo(() => revenuePrev.reduce((s, t) => s + t.amount_cents, 0), [revenuePrev]);
  const expTotal     = useMemo(() => expenses.reduce((s, t) => s + t.amount_cents, 0), [expenses]);
  const expPrevTotal = useMemo(() => expensesPrev.reduce((s, t) => s + t.amount_cents, 0), [expensesPrev]);
  const net      = revTotal - expTotal;
  const prevNet  = revPrevTotal - expPrevTotal;
  const margin     = revTotal > 0 ? (net / revTotal) * 100 : null;
  const prevMargin = revPrevTotal > 0 ? (prevNet / revPrevTotal) * 100 : null;

  const revByCat = useMemo(() => groupByCategory(revenue, REVENUE_CATEGORY_META), [revenue]);
  const expByCat = useMemo(() => groupByCategory(expenses, EXPENSE_CATEGORY_META), [expenses]);

  const monthly = useMemo(() => buildMonthlyDualSeries(revenue, expenses), [revenue, expenses]);

  const ledger = useMemo(() => buildLedger(revenue, expenses).slice(0, 200), [revenue, expenses]);

  return (
    <>
      <div style={styles.kpiRow}>
        <KpiCard
          label="Net"
          value={formatMoney(net)}
          delta={pctDelta(net, prevNet)}
          accent={net >= 0 ? '#4ade80' : '#f87171'}
          valueColor={net >= 0 ? '#4ade80' : '#f87171'}
          deltaInvert={false}
        />
        <KpiCard
          label="Revenue"
          value={formatMoney(revTotal)}
          delta={pctDelta(revTotal, revPrevTotal)}
          accent="#22c55e"
          deltaInvert={false}
        />
        <KpiCard
          label="Expenses"
          value={formatMoney(expTotal)}
          delta={pctDelta(expTotal, expPrevTotal)}
          accent="#ef4444"
          deltaInvert={true}
        />
        <KpiCard
          label="Margin"
          value={margin == null ? '—' : `${margin.toFixed(1)}%`}
          delta={margin != null && prevMargin != null ? (margin - prevMargin) : null}
          deltaUnit="pp"
          accent="#a855f7"
          deltaInvert={false}
        />
      </div>

      <div style={styles.chartCard}>
        <div style={styles.chartTitle}>Monthly Trend</div>
        {monthly.length === 0 ? (
          <p style={styles.emptyText}>Not enough data.</p>
        ) : (
          <TrendChart
            data={monthly}
            metrics={[
              { key: 'revenue',  label: 'Revenue',  color: '#22c55e', getValue: r => r.revenue / 100,  formatValue: v => '$' + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
              { key: 'expenses', label: 'Expenses', color: '#ef4444', getValue: r => r.expenses / 100, formatValue: v => '$' + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
              { key: 'net',      label: 'Net',      color: '#a5b4fc', getValue: r => r.net / 100,      formatValue: v => '$' + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
            ]}
            height={260}
            sharedScale
          />
        )}
      </div>

      <div style={styles.chartsRow}>
        <div style={styles.chartCard}>
          <div style={{ ...styles.chartTitle, color: '#22c55e' }}>Revenue by Source</div>
          {revByCat.length === 0 ? (
            <p style={styles.emptyText}>No revenue in this range.</p>
          ) : (
            <CategoryDonut data={revByCat} total={revTotal} />
          )}
        </div>
        <div style={styles.chartCard}>
          <div style={{ ...styles.chartTitle, color: '#ef4444' }}>Expenses by Category</div>
          {expByCat.length === 0 ? (
            <p style={styles.emptyText}>No expenses in this range.</p>
          ) : (
            <CategoryDonut data={expByCat} total={expTotal} />
          )}
        </div>
      </div>

      <div style={styles.tableCard}>
        <button
          type="button"
          onClick={() => setLedgerOpen(v => !v)}
          style={styles.tableToggle}
        >
          <span style={styles.tableToggleCaret}>{ledgerOpen ? '▾' : '▸'}</span>
          <span style={styles.tableTitle}>Ledger ({ledger.length} most recent)</span>
        </button>
        {ledgerOpen && (
          <div style={styles.tableScroll}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Date</th>
                  <th style={styles.th}>Type</th>
                  <th style={styles.th}>Category</th>
                  <th style={styles.th}>Description</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((t, i) => {
                  // Revenue stored as positive cents. Expense stored as positive
                  // cents (sign-flipped at sync). Credits (refunds) on the expense
                  // side are negative cents. Visual logic:
                  //   revenue row → credit (money in)  → green
                  //   expense row (positive) → debit  → red
                  //   expense row (negative) → credit → green
                  const isCredit = t.kind === 'revenue' || t.amount_cents < 0;
                  const color = isCredit ? '#4ade80' : '#f87171';
                  const sign  = isCredit ? '+' : '−';
                  const abs   = Math.abs(t.amount_cents);
                  const meta  = t.kind === 'revenue' ? REVENUE_CATEGORY_META[t.category] : EXPENSE_CATEGORY_META[t.category];
                  return (
                    <tr key={`${t.kind}-${t.date}-${i}`} style={styles.tr}>
                      <td style={styles.td}>{t.date}</td>
                      <td style={styles.td}>
                        <span style={{
                          ...styles.kindPill,
                          background: t.kind === 'revenue' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                          color: t.kind === 'revenue' ? '#4ade80' : '#f87171',
                        }}>
                          {t.kind === 'revenue' ? 'REV' : 'EXP'}
                        </span>
                      </td>
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
                      <td style={{ ...styles.td, textAlign: 'right', color, fontWeight: 600 }}>
                        {sign}{formatMoney(abs)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ── Revenue / Expenses Tab ──────────────────────────────────────────────────
function LedgerTab({ mode, data, prevData, meta, accentColor, headlineLabel }) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [sortBy, setSortBy] = useState('date_desc');
  const [tableOpen, setTableOpen] = useState(false);

  const total     = useMemo(() => data.reduce((s, t) => s + t.amount_cents, 0), [data]);
  const prevTotal = useMemo(() => prevData.reduce((s, t) => s + t.amount_cents, 0), [prevData]);
  const delta = pctDelta(total, prevTotal);

  const byCategory = useMemo(() => groupByCategory(data, meta), [data, meta]);
  const byMonth    = useMemo(() => buildMonthly(data), [data]);
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

  if (data.length === 0) {
    return <p style={styles.emptyText}>No {mode === 'revenue' ? 'revenue' : 'expenses'} in this range.</p>;
  }

  return (
    <>
      <div style={styles.kpiRow}>
        <KpiCard
          label={headlineLabel}
          value={formatMoney(total)}
          delta={delta}
          accent={accentColor}
          deltaInvert={mode === 'expense'}
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
          value={formatMoney(data.length ? Math.round(total / data.length) : 0)}
          accent="#a855f7"
        />
      </div>

      <div style={styles.chartsRow}>
        <div style={styles.chartCard}>
          <div style={styles.chartTitle}>By Category</div>
          <CategoryDonut data={byCategory} total={total} />
        </div>
        <div style={styles.chartCard}>
          <div style={styles.chartTitle}>Monthly Trend</div>
          {byMonth.length === 0 ? (
            <p style={styles.emptyText}>Not enough data.</p>
          ) : (
            <TrendChart
              data={byMonth}
              metrics={[{
                key: mode, label: headlineLabel, color: accentColor,
                getValue: r => r.total / 100,
                formatValue: v => '$' + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
              }]}
              height={240}
            />
          )}
        </div>
      </div>

      <div style={styles.tableCard}>
        <button
          type="button"
          onClick={() => setTableOpen(v => !v)}
          style={styles.tableToggle}
        >
          <span style={styles.tableToggleCaret}>{tableOpen ? '▾' : '▸'}</span>
          <span style={styles.tableTitle}>Transactions ({filteredRows.length})</span>
        </button>
        {tableOpen && (
          <>
            <div style={styles.tableControls}>
              <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} style={styles.control}>
                <option value="all">All categories</option>
                {byCategory.map(c => (
                  <option key={c.category} value={c.category}>{c.label}</option>
                ))}
              </select>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={styles.control}>
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
                    const m = meta[t.category];
                    // Revenue rows are always credits → green. Expense rows:
                    // positive cents = debit (red), negative cents = credit (green).
                    const isCredit = mode === 'revenue' || t.amount_cents < 0;
                    const color = isCredit ? '#4ade80' : '#f87171';
                    const sign  = isCredit ? '+' : '−';
                    const abs   = Math.abs(t.amount_cents);
                    return (
                      <tr key={`${t.date}-${i}`} style={styles.tr}>
                        <td style={styles.td}>{t.date}</td>
                        <td style={styles.td}>
                          <span style={{
                            ...styles.catChip,
                            background: (m?.color || '#71717a') + '22',
                            color: m?.color || '#a3a3a3',
                            borderColor: (m?.color || '#71717a') + '55',
                          }}>
                            {m?.label || t.category}
                          </span>
                        </td>
                        <td style={{ ...styles.td, color: 'rgba(255,255,255,0.85)' }}>{t.description || '—'}</td>
                        <td style={{ ...styles.td, color: 'rgba(255,255,255,0.55)' }}>{t.account || '—'}</td>
                        <td style={{ ...styles.td, textAlign: 'right', color, fontWeight: 600 }}>
                          {sign}{formatMoney(abs)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function groupByCategory(rows, meta) {
  const map = {};
  for (const tx of rows) {
    const m = meta[tx.category];
    const label = m?.label || tx.category;
    const color = m?.color || '#71717a';
    if (!map[tx.category]) map[tx.category] = { category: tx.category, label, color, total: 0, count: 0 };
    map[tx.category].total += tx.amount_cents;
    map[tx.category].count += 1;
  }
  return Object.values(map).sort((a, b) => b.total - a.total);
}

function buildMonthly(rows) {
  const map = {};
  for (const tx of rows) {
    const m = monthKey(tx.date);
    if (!m) continue;
    map[m] = (map[m] || 0) + tx.amount_cents;
  }
  return Object.entries(map).sort(([a], [b]) => a.localeCompare(b))
    .map(([month, total]) => ({ month, date: `${month}-01`, total }));
}

function buildMonthlyDualSeries(revenue, expenses) {
  const months = new Set();
  const rev = {}, exp = {};
  for (const tx of revenue)  { const m = monthKey(tx.date); months.add(m); rev[m] = (rev[m] || 0) + tx.amount_cents; }
  for (const tx of expenses) { const m = monthKey(tx.date); months.add(m); exp[m] = (exp[m] || 0) + tx.amount_cents; }
  return Array.from(months).filter(Boolean).sort().map(m => ({
    month: m,
    date: `${m}-01`,
    revenue: rev[m] || 0,
    expenses: exp[m] || 0,
    net: (rev[m] || 0) - (exp[m] || 0),
  }));
}

function buildLedger(revenue, expenses) {
  const rows = [];
  for (const r of revenue)  rows.push({ ...r, kind: 'revenue' });
  for (const e of expenses) rows.push({ ...e, kind: 'expense' });
  rows.sort((a, b) => b.date.localeCompare(a.date));
  return rows;
}

// ── Sub-components ──────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, delta, deltaUnit, accent, valueColor, deltaInvert }) {
  let deltaColor;
  if (delta == null) deltaColor = null;
  else if (delta === 0) deltaColor = 'rgba(255,255,255,0.4)';
  else {
    const positive = delta > 0;
    const good = deltaInvert ? !positive : positive;
    deltaColor = good ? '#4ade80' : '#f87171';
  }
  return (
    <div style={{ ...styles.kpiCard, borderLeft: `3px solid ${accent || '#6366f1'}` }}>
      <div style={styles.kpiLabel}>{label}</div>
      <div style={{ ...styles.kpiValue, ...(valueColor ? { color: valueColor } : {}) }}>{value}</div>
      {sub && <div style={styles.kpiSub}>{sub}</div>}
      {delta != null && (
        <div style={{ ...styles.kpiDelta, color: deltaColor }}>
          {delta > 0 ? '▲' : delta < 0 ? '▼' : '•'} {Math.abs(delta).toFixed(1)}{deltaUnit || '%'} vs prior period
        </div>
      )}
    </div>
  );
}

function CategoryDonut({ data, total }) {
  return (
    <div style={styles.donutRow}>
      <DonutChart
        data={data.map(c => ({ label: c.label, value: c.total, color: c.color }))}
        valueKey="value"
        centerLabel="total"
        formatValue={v => '$' + formatCompact(v / 100)}
      />
      <div style={styles.legend}>
        {data.map(c => {
          const pct = total > 0 ? (c.total / total) * 100 : 0;
          return (
            <div key={c.category} style={styles.legendRow}>
              <span style={{ ...styles.catSwatch, background: c.color }} />
              <span style={styles.legendLabel}>{c.label}</span>
              <span style={styles.legendValue}>{formatMoney(c.total)}</span>
              <span style={styles.legendPct}>({pct.toFixed(1)}%)</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
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
    marginBottom: 18,
    flexWrap: 'wrap',
    gap: 12,
  },
  title: { fontSize: 26, fontWeight: 700, margin: 0, letterSpacing: -0.5 },
  headerControls: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  rangeBar: { display: 'flex', gap: 6 },
  refreshBtn: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '6px 12px', fontSize: 12, borderRadius: 6,
    background: 'rgba(99,102,241,0.18)', color: '#fff',
    border: '1px solid rgba(99,102,241,0.5)', cursor: 'pointer', fontFamily: 'inherit',
  },
  refreshBtnDisabled: { opacity: 0.6, cursor: 'default' },
  refreshIcon: { fontSize: 14, display: 'inline-block', lineHeight: 1 },
  refreshIconSpin: { animation: 'spin 0.8s linear infinite' },
  errorBanner: {
    background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)',
    color: '#fca5a5', borderRadius: 8, padding: '10px 14px',
    fontSize: 13, marginBottom: 16,
  },
  rangePill: {
    padding: '6px 12px', fontSize: 12, borderRadius: 6,
    background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.6)',
    border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer', fontFamily: 'inherit',
  },
  rangePillActive: {
    background: 'rgba(99,102,241,0.18)', color: '#fff', borderColor: 'rgba(99,102,241,0.5)',
  },

  tabBar: {
    display: 'flex',
    gap: 4,
    marginBottom: 18,
    borderBottom: '1px solid rgba(255,255,255,0.08)',
  },
  tab: {
    padding: '10px 18px',
    background: 'transparent',
    border: 'none',
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    fontWeight: 500,
    fontFamily: 'inherit',
    cursor: 'pointer',
    borderBottom: '2px solid transparent',
    marginBottom: -1,
  },
  tabActive: {
    color: '#fff',
    borderBottomColor: '#6366f1',
  },

  emptyText: { color: 'rgba(255,255,255,0.4)', fontSize: 14 },

  kpiRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 12, marginBottom: 18,
  },
  kpiCard: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 10, padding: '14px 16px',
  },
  kpiLabel: {
    fontSize: 11, color: 'rgba(255,255,255,0.45)',
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6,
  },
  kpiValue: { fontSize: 22, fontWeight: 700, color: '#fff' },
  kpiSub: { fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 2 },
  kpiDelta: { fontSize: 11, marginTop: 6 },

  chartsRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
    gap: 12, marginBottom: 18,
  },
  chartCard: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 10, padding: 16, marginBottom: 18,
  },
  chartTitle: {
    fontSize: 13, fontWeight: 600,
    color: 'rgba(255,255,255,0.85)', marginBottom: 12,
  },

  donutRow: { display: 'flex', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' },
  legend: {
    display: 'flex', flexDirection: 'column', gap: 4,
    flex: 1, minWidth: 200, maxHeight: 280, overflowY: 'auto',
  },
  legendRow: {
    display: 'grid',
    gridTemplateColumns: '12px 1fr auto auto',
    alignItems: 'center', gap: 8, fontSize: 12,
  },
  legendLabel: {
    color: 'rgba(255,255,255,0.7)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  legendValue: {
    color: '#fff', fontWeight: 600, fontVariantNumeric: 'tabular-nums',
  },
  legendPct: {
    color: 'rgba(255,255,255,0.35)', fontSize: 10, fontVariantNumeric: 'tabular-nums',
  },
  catSwatch: { width: 10, height: 10, borderRadius: 2, display: 'inline-block', flexShrink: 0 },

  tableCard: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 10, padding: 16,
  },
  tableToggle: {
    display: 'flex', alignItems: 'center', gap: 8,
    background: 'transparent', border: 'none', color: '#fff',
    cursor: 'pointer', padding: 0, fontFamily: 'inherit', width: '100%',
  },
  tableToggleCaret: {
    fontSize: 12, color: 'rgba(255,255,255,0.55)', width: 12, textAlign: 'center',
  },
  tableTitle: {
    fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.85)',
  },
  tableControls: {
    display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, marginBottom: 10,
  },
  control: {
    background: 'rgba(255,255,255,0.04)', color: '#fff',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 6, padding: '6px 10px', fontSize: 12, fontFamily: 'inherit',
  },
  tableScroll: { overflowX: 'auto', maxHeight: 540, overflowY: 'auto', marginTop: 8 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: {
    position: 'sticky', top: 0,
    background: 'rgba(15,15,26,0.95)',
    backdropFilter: 'blur(4px)',
    textAlign: 'left', padding: '8px 10px',
    color: 'rgba(255,255,255,0.45)', fontWeight: 500,
    textTransform: 'uppercase', fontSize: 10, letterSpacing: 0.5,
    borderBottom: '1px solid rgba(255,255,255,0.08)',
  },
  tr: { borderBottom: '1px solid rgba(255,255,255,0.04)' },
  td: {
    padding: '8px 10px',
    color: 'rgba(255,255,255,0.7)',
    fontVariantNumeric: 'tabular-nums',
  },
  catChip: {
    padding: '2px 8px', borderRadius: 4, border: '1px solid',
    fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap',
  },
  kindPill: {
    padding: '2px 7px', borderRadius: 4,
    fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
  },
};
