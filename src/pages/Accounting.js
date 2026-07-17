import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import usePersistedTab from '../hooks/usePersistedTab';
import { DonutChart, TrendChart, formatCompact } from '../lib/charts';
import { fetchAllRows } from './analytics/utils';
import BankAccountsTab from '../components/accounting/BankAccountsTab';
import TransactionsTab from '../components/accounting/TransactionsTab';
import MonthlyReportsTab from '../components/accounting/MonthlyReportsTab';

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
  'Interest':           { label: 'Interest',     color: '#84cc16' },
  'Reimbursement':      { label: 'Reimbursement', color: '#94a3b8' },
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
  { key: 'overview',     label: 'Overview' },
  { key: 'revenue',      label: 'Revenue' },
  { key: 'expenses',     label: 'Expenses' },
  { key: 'transactions', label: 'Transactions' },
  { key: 'accounts',     label: 'Accounts' },
  { key: 'reports',      label: 'Reports' },
];

// The two businesses synced from their own Tiller sheets. Rows predating the
// multi-business split default to mayday_media (see the migration).
const BUSINESSES = {
  mayday_media:        { label: 'Mayday Media',        color: '#6366f1' },
  neptune_performance: { label: 'Neptune Performance', color: '#06b6d4' },
};
const isMayday  = (t) => (t.business || 'mayday_media') === 'mayday_media';
const isNeptune = (t) => t.business === 'neptune_performance';

// Sub-tabs shared by the Overview, Revenue, and Expenses top-level tabs.
const BUSINESS_SUBTABS = [
  { key: 'all',                 label: 'Overall' },
  { key: 'mayday_media',        label: 'Mayday Media' },
  { key: 'neptune_performance', label: 'Neptune Performance' },
];

// Color cycle for businesses without a fixed category meta map (Neptune's
// categories come straight from its sheet, so we color them on the fly).
const DYNAMIC_PALETTE = [
  '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7',
  '#d946ef', '#ec4899', '#f43f5e', '#f97316', '#f59e0b', '#eab308',
  '#84cc16', '#22c55e', '#10b981', '#14b8a6',
];

// Sponsor-campaign revenue pipeline (migrated from the Deliverables page).
// Feeds Mayday Media's "Incoming Revenue" cards. Other sources can be folded
// into these buckets later.
const AGENCY_FEE = 0.20;      // standard agency cut on sponsor payouts
const OUTSTANDING_DAYS = 45;  // payment due window after a campaign is delivered

// Bucket unpaid sponsor campaigns into expected / outstanding / late (in cents,
// net of the agency fee where it applies). Paid campaigns are excluded — that
// money is realized and already shows up in the Tiller revenue total.
function computeSponsorPipeline(campaigns, deliverables) {
  const grossCentsByCampaign = new Map();
  for (const d of deliverables) {
    const cents = Math.round((parseFloat(d.pay) || 0) * 100);
    grossCentsByCampaign.set(d.campaign_id, (grossCentsByCampaign.get(d.campaign_id) || 0) + cents);
  }
  const now = Date.now();
  let expected = 0, outstanding = 0, late = 0;
  for (const c of campaigns) {
    if (c.payment_status === 'paid') continue;
    const gross = grossCentsByCampaign.get(c.id) || 0;
    const net = c.apply_agency_fee === false ? gross : Math.round(gross * (1 - AGENCY_FEE));
    if (c.fully_delivered_at) {
      const days = (now - new Date(c.fully_delivered_at).getTime()) / 86400000;
      if (days > OUTSTANDING_DAYS) late += net;
      else outstanding += net;
    } else {
      expected += net;
    }
  }
  return { expected, outstanding, late, incoming: expected + outstanding + late };
}

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

// Step a YYYY-MM-DD string forward by n days (local-time safe).
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${dt.getFullYear()}-${mm}-${dd}`;
}

function pctDelta(curr, prev) {
  if (prev === 0) return null;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

// ── Page ────────────────────────────────────────────────────────────────────
export default function Accounting({ initialTab, onTabOpened }) {
  const { isAdmin } = useAuth();
  const [rangeKey, setRangeKey] = useState('90d');
  const [tab, setTab] = usePersistedTab('accounting', 'overview', ['overview', 'revenue', 'expenses', 'transactions', 'accounts', 'reports']);

  // Deep-link from bell notifications (link_target = a tab key, e.g. 'reports')
  useEffect(() => {
    if (initialTab && TABS.some(t => t.key === initialTab)) {
      setTab(initialTab);
      onTabOpened?.();
    }
  }, [initialTab, onTabOpened]);

  const [revenue, setRevenue]       = useState([]);
  const [revenuePrev, setRevenuePrev] = useState([]);
  const [expenses, setExpenses]     = useState([]);
  const [expensesPrev, setExpensesPrev] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(null);
  const [sponsorPipeline, setSponsorPipeline] = useState({ expected: 0, outstanding: 0, late: 0, incoming: 0 });

  const load = useCallback(async ({ signal } = {}) => {
    const { start, end } = getRange(rangeKey);
    const daysDiff = Math.max(1, Math.ceil((new Date(end) - new Date(start)) / 86400000));
    const prevStart = new Date(new Date(start).getTime() - daysDiff * 86400000).toISOString().slice(0, 10);

    // Transaction tables are paginated past Supabase's 1000-row default — Tiller
    // syncs every bank/CC line, so any real range exceeds 1000 and unpaginated
    // fetches silently understated revenue/expense/net/margin. Prev-period
    // queries also need a deterministic .order() for stable pagination.
    const [revCur, revOld, expCur, expOld, campaigns, deliverables] = await Promise.all([
      // is_transfer=false: inter-account transfers from the Plaid feed are
      // flagged, not deleted — they must not count as revenue or expense.
      // is_duplicate=false: same for rows resolved as duplicates in the
      // Transactions tab's Duplicates view.
      fetchAllRows(supabase.from('revenue_transactions')
        .select('date, description, category, amount_cents, account, business')
        .eq('is_transfer', false).eq('is_duplicate', false)
        .gte('date', start).lte('date', end).order('date', { ascending: false })),
      fetchAllRows(supabase.from('revenue_transactions')
        .select('date, category, amount_cents, business')
        .eq('is_transfer', false).eq('is_duplicate', false)
        .gte('date', prevStart).lt('date', start).order('date', { ascending: false })),
      fetchAllRows(supabase.from('expense_transactions')
        .select('date, description, category, amount_cents, account, business')
        .eq('is_transfer', false).eq('is_duplicate', false)
        .gte('date', start).lte('date', end).order('date', { ascending: false })),
      fetchAllRows(supabase.from('expense_transactions')
        .select('date, category, amount_cents, business')
        .eq('is_transfer', false).eq('is_duplicate', false)
        .gte('date', prevStart).lt('date', start).order('date', { ascending: false })),
      // Sponsor revenue pipeline (range-independent current snapshot).
      supabase.from('sponsor_campaigns').select('id, payment_status, apply_agency_fee, fully_delivered_at'),
      supabase.from('sponsor_deliverables').select('campaign_id, pay'),
    ]);

    if (signal?.aborted) return;
    setRevenue(revCur || []);
    setRevenuePrev(revOld || []);
    setExpenses(expCur || []);
    setExpensesPrev(expOld || []);
    setSponsorPipeline(computeSponsorPipeline(campaigns.data || [], deliverables.data || []));
  }, [rangeKey]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    load({ signal: controller.signal }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [load]);

  // Pull fresh transactions from both feeds — Tiller (legacy, until cutover)
  // and Plaid (bank connections) — then re-read the tables for the current
  // range. Either feed failing doesn't block the other.
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      const results = await Promise.allSettled([
        supabase.functions.invoke('sync-tiller', { body: {} }),
        supabase.functions.invoke('plaid-sync', { body: {} }),
      ]);
      const failed = results
        .map((r, i) => ({ r, name: i === 0 ? 'Tiller' : 'Plaid' }))
        .filter(({ r }) => r.status === 'rejected' || r.value?.error);
      if (failed.length > 0) {
        setRefreshError(`${failed.map(f => f.name).join(' + ')} sync failed. Data may be partial.`);
      }
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
          {/* Range pills don't apply to monthly reports (they have their own month picker) */}
          {tab !== 'reports' && (
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
          )}
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing || loading}
            style={{
              ...styles.refreshBtn,
              ...(refreshing || loading ? styles.refreshBtnDisabled : {}),
            }}
            title="Sync transactions from Tiller + bank feeds"
          >
            <span style={{
              ...styles.refreshIcon,
              ...(refreshing ? styles.refreshIconSpin : {}),
            }}>↻</span>
            {refreshing ? 'Syncing…' : 'Sync'}
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
        <OverviewView
          revenue={revenue} revenuePrev={revenuePrev}
          expenses={expenses} expensesPrev={expensesPrev}
        />
      ) : tab === 'revenue' ? (
        <BusinessTabbedView
          mode="revenue"
          data={revenue} prevData={revenuePrev}
          maydayMeta={REVENUE_CATEGORY_META}
          accentColor="#22c55e"
          sponsorPipeline={sponsorPipeline}
        />
      ) : tab === 'expenses' ? (
        <BusinessTabbedView
          mode="expense"
          data={expenses} prevData={expensesPrev}
          maydayMeta={EXPENSE_CATEGORY_META}
          accentColor="#ef4444"
        />
      ) : tab === 'transactions' ? (
        <TransactionsTab
          revenueMeta={REVENUE_CATEGORY_META}
          expenseMeta={EXPENSE_CATEGORY_META}
          onChanged={load}
        />
      ) : tab === 'reports' ? (
        <MonthlyReportsTab />
      ) : (
        <BankAccountsTab onSynced={load} />
      )}
    </div>
  );
}

// ── Overview Tab ────────────────────────────────────────────────────────────
function OverviewTab({ revenue, revenuePrev, expenses, expensesPrev }) {
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [trendMode, setTrendMode] = useState('daily');

  const revTotal     = useMemo(() => revenue.reduce((s, t) => s + (t.amount_cents || 0), 0), [revenue]);
  const revPrevTotal = useMemo(() => revenuePrev.reduce((s, t) => s + (t.amount_cents || 0), 0), [revenuePrev]);
  const expTotal     = useMemo(() => expenses.reduce((s, t) => s + (t.amount_cents || 0), 0), [expenses]);
  const expPrevTotal = useMemo(() => expensesPrev.reduce((s, t) => s + (t.amount_cents || 0), 0), [expensesPrev]);
  const net      = revTotal - expTotal;
  const prevNet  = revPrevTotal - expPrevTotal;
  const margin     = revTotal > 0 ? (net / revTotal) * 100 : null;
  const prevMargin = revPrevTotal > 0 ? (prevNet / revPrevTotal) * 100 : null;

  const revByCat = useMemo(() => groupByCategory(revenue, REVENUE_CATEGORY_META), [revenue]);
  const expByCat = useMemo(() => groupByCategory(expenses, EXPENSE_CATEGORY_META), [expenses]);

  const daily = useMemo(() => buildDailyDualSeries(revenue, expenses), [revenue, expenses]);
  const trendData = useMemo(
    () => (trendMode === 'cumulative' ? toCumulative(daily, ['revenue', 'expenses', 'net']) : daily),
    [daily, trendMode],
  );

  const ledger = useMemo(() => buildLedger(revenue, expenses).slice(0, 200), [revenue, expenses]);

  return (
    <>
      <div style={styles.kpiRow}>
        <KpiCard
          label="Net"
          value={formatMoney(net)}
          delta={pctDelta(net, prevNet)}
          accent={net >= 0 ? '#22c55e' : '#f87171'}
          valueColor={net >= 0 ? '#22c55e' : '#f87171'}
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
        <TrendModeSelect value={trendMode} onChange={setTrendMode} />
        {trendData.length === 0 ? (
          <p style={styles.emptyText}>Not enough data.</p>
        ) : (
          <TrendChart
            data={trendData}
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
                  const color = isCredit ? '#22c55e' : '#f87171';
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
                          color: t.kind === 'revenue' ? '#22c55e' : '#f87171',
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
function LedgerTab({ mode, data, prevData, meta, accentColor, headlineLabel, headerNode }) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [sortBy, setSortBy] = useState('date_desc');
  const [tableOpen, setTableOpen] = useState(false);
  const [trendMode, setTrendMode] = useState('daily');

  const total     = useMemo(() => data.reduce((s, t) => s + (t.amount_cents || 0), 0), [data]);
  const prevTotal = useMemo(() => prevData.reduce((s, t) => s + (t.amount_cents || 0), 0), [prevData]);
  const delta = pctDelta(total, prevTotal);

  const byCategory = useMemo(() => groupByCategory(data, meta), [data, meta]);
  const byDay      = useMemo(() => buildDaily(data), [data]);
  const trendData  = useMemo(
    () => (trendMode === 'cumulative' ? toCumulative(byDay, ['total']) : byDay),
    [byDay, trendMode],
  );
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
    return (
      <>
        {headerNode}
        <p style={styles.emptyText}>No {mode === 'revenue' ? 'revenue' : 'expenses'} in this range.</p>
      </>
    );
  }

  return (
    <>
      {headerNode || (
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
      )}

      <div style={styles.chartsRow}>
        <div style={styles.chartCard}>
          <div style={styles.chartTitle}>By Category</div>
          <CategoryDonut data={byCategory} total={total} />
        </div>
        <div style={styles.chartCard}>
          <TrendModeSelect value={trendMode} onChange={setTrendMode} />
          {trendData.length === 0 ? (
            <p style={styles.emptyText}>Not enough data.</p>
          ) : (
            <TrendChart
              data={trendData}
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
                    const color = isCredit ? '#22c55e' : '#f87171';
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

// ── Expenses Tab (per-business) ───────────────────────────────────────────────
// Pill bar shared by every top-level tab: Overall / Mayday Media / Neptune.
function BusinessSubTabs({ subTab, setSubTab }) {
  return (
    <div style={styles.subTabBar}>
      {BUSINESS_SUBTABS.map(t => (
        <button
          key={t.key}
          onClick={() => setSubTab(t.key)}
          style={{ ...styles.subTab, ...(subTab === t.key ? styles.subTabActive : {}) }}
        >
          {BUSINESSES[t.key] && (
            <span style={{ ...styles.subTabDot, background: BUSINESSES[t.key].color }} />
          )}
          {t.label}
        </button>
      ))}
    </div>
  );
}

// Custom KPI header for Mayday Media revenue: Realized (Tiller) + Incoming
// (sponsor pipeline) + Projected (the sum), with a collapsible breakdown of the
// incoming buckets.
function RevenuePipelineHeader({ realizedCents, pipeline }) {
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const incoming = pipeline.incoming;
  const projected = realizedCents + incoming;
  return (
    <>
      <div style={styles.kpiRow}>
        <KpiCard label="Realized Revenue"  value={formatMoney(realizedCents)} accent="#22c55e" />
        <KpiCard label="Incoming Revenue"  value={formatMoney(incoming)}      accent="#3b82f6" />
        <KpiCard label="Projected Revenue" value={formatMoney(projected)}     accent="#6366f1" />
      </div>

      <div style={styles.tableCard}>
        <button type="button" onClick={() => setBreakdownOpen(v => !v)} style={styles.tableToggle}>
          <span style={styles.tableToggleCaret}>{breakdownOpen ? '▾' : '▸'}</span>
          <span style={styles.tableTitle}>Incoming Breakdown</span>
        </button>
        {breakdownOpen && (
          <div style={{ ...styles.kpiRow, marginTop: 12, marginBottom: 0 }}>
            <KpiCard label="Expected"    value={formatMoney(pipeline.expected)}    accent="#3b82f6" />
            <KpiCard label="Outstanding" value={formatMoney(pipeline.outstanding)} accent="#f59e0b" />
            <KpiCard label="Late"        value={formatMoney(pipeline.late)}        accent={pipeline.late > 0 ? '#ef4444' : '#22c55e'} />
          </div>
        )}
      </div>
    </>
  );
}

// Revenue / Expenses tab: Overall (comparison or combined) + a per-business
// ledger for each company. `mode` is 'revenue' or 'expense'.
function BusinessTabbedView({ mode, data, prevData, maydayMeta, accentColor, sponsorPipeline }) {
  const [subTab, setSubTab] = useState('all');

  const mayday      = useMemo(() => data.filter(isMayday), [data]);
  const maydayPrev  = useMemo(() => prevData.filter(isMayday), [prevData]);
  const neptune     = useMemo(() => data.filter(isNeptune), [data]);
  const neptunePrev = useMemo(() => prevData.filter(isNeptune), [prevData]);
  const neptuneMeta = useMemo(() => buildDynamicMeta(neptune), [neptune]);

  const noun = mode === 'revenue' ? 'revenue' : 'expenses';

  // Mayday Media revenue gets the Realized/Incoming/Projected header.
  const maydayHeader = (mode === 'revenue' && sponsorPipeline)
    ? <RevenuePipelineHeader realizedCents={mayday.reduce((s, t) => s + t.amount_cents, 0)} pipeline={sponsorPipeline} />
    : null;

  return (
    <>
      <BusinessSubTabs subTab={subTab} setSubTab={setSubTab} />

      {subTab === 'all' ? (
        <BusinessComparison
          mode={mode} mayday={mayday} neptune={neptune}
          maydayMeta={maydayMeta} neptuneMeta={neptuneMeta} accentColor={accentColor}
        />
      ) : subTab === 'mayday_media' ? (
        <LedgerTab
          mode={mode}
          data={mayday} prevData={maydayPrev}
          meta={maydayMeta}
          accentColor={BUSINESSES.mayday_media.color}
          headlineLabel={`Mayday Media ${noun}`}
          headerNode={maydayHeader}
        />
      ) : (
        <LedgerTab
          mode={mode}
          data={neptune} prevData={neptunePrev}
          meta={neptuneMeta}
          accentColor={BUSINESSES.neptune_performance.color}
          headlineLabel={`Neptune Performance ${noun}`}
        />
      )}
    </>
  );
}

function ComparisonToggle({ view, setView }) {
  return (
    <div style={styles.segmented}>
      {[['comparison', 'Comparison'], ['combined', 'Combined']].map(([k, l]) => (
        <button
          key={k}
          onClick={() => setView(k)}
          style={{ ...styles.segBtn, ...(view === k ? styles.segBtnActive : {}) }}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

// The "Overall" sub-tab for Revenue / Expenses: toggle between a Mayday-vs-
// Neptune comparison and one combined company-wide ledger.
function BusinessComparison({ mode, mayday, neptune, maydayMeta, neptuneMeta, accentColor }) {
  const [view, setView] = useState('comparison');
  const [trendMode, setTrendMode] = useState('daily');

  const maydayTotal  = useMemo(() => mayday.reduce((s, t) => s + (t.amount_cents || 0), 0), [mayday]);
  const neptuneTotal = useMemo(() => neptune.reduce((s, t) => s + (t.amount_cents || 0), 0), [neptune]);
  const combined = maydayTotal + neptuneTotal;

  const maydayByCat  = useMemo(() => groupByCategory(mayday, maydayMeta), [mayday, maydayMeta]);
  const neptuneByCat = useMemo(() => groupByCategory(neptune, neptuneMeta), [neptune, neptuneMeta]);

  const dailyRaw = useMemo(() => buildDailyByBusiness(mayday, neptune), [mayday, neptune]);
  const trendData = useMemo(
    () => (trendMode === 'cumulative' ? toCumulative(dailyRaw, ['mayday', 'neptune']) : dailyRaw),
    [dailyRaw, trendMode],
  );

  const noun = mode === 'revenue' ? 'revenue' : 'expenses';
  const breakdown = mode === 'revenue' ? 'Source' : 'Category';

  if (mayday.length === 0 && neptune.length === 0) {
    return (
      <>
        <ComparisonToggle view={view} setView={setView} />
        <p style={styles.emptyText}>No {noun} in this range.</p>
      </>
    );
  }

  if (view === 'combined') {
    const mergedMeta = { ...maydayMeta, ...neptuneMeta };
    const all = [...mayday, ...neptune];
    return (
      <>
        <ComparisonToggle view={view} setView={setView} />
        <LedgerTab
          mode={mode}
          data={all} prevData={[]}
          meta={mergedMeta}
          accentColor={accentColor}
          headlineLabel={`All ${noun}`}
        />
      </>
    );
  }

  return (
    <>
      <ComparisonToggle view={view} setView={setView} />
      <div style={styles.kpiRow}>
        <KpiCard label="Mayday Media" value={formatMoney(maydayTotal)}
          sub={pctOfTotal(maydayTotal, combined)} accent={BUSINESSES.mayday_media.color} />
        <KpiCard label="Neptune Performance" value={formatMoney(neptuneTotal)}
          sub={pctOfTotal(neptuneTotal, combined)} accent={BUSINESSES.neptune_performance.color} />
        <KpiCard label="Combined" value={formatMoney(combined)} accent={accentColor} />
        <KpiCard label="Transactions" value={(mayday.length + neptune.length).toLocaleString()} accent="#3b82f6" />
      </div>

      <div style={styles.chartCard}>
        <TrendModeSelect value={trendMode} onChange={setTrendMode} />
        {trendData.length === 0 ? (
          <p style={styles.emptyText}>Not enough data.</p>
        ) : (
          <TrendChart
            data={trendData}
            metrics={[
              { key: 'mayday',  label: 'Mayday Media',        color: BUSINESSES.mayday_media.color,        getValue: r => r.mayday / 100,  formatValue: fmtDollars },
              { key: 'neptune', label: 'Neptune Performance', color: BUSINESSES.neptune_performance.color, getValue: r => r.neptune / 100, formatValue: fmtDollars },
            ]}
            height={260}
            sharedScale
          />
        )}
      </div>

      <div style={styles.chartsRow}>
        <div style={styles.chartCard}>
          <div style={{ ...styles.chartTitle, color: BUSINESSES.mayday_media.color }}>Mayday Media by {breakdown}</div>
          {maydayByCat.length === 0 ? (
            <p style={styles.emptyText}>No {noun} in this range.</p>
          ) : (
            <CategoryDonut data={maydayByCat} total={maydayTotal} />
          )}
        </div>
        <div style={styles.chartCard}>
          <div style={{ ...styles.chartTitle, color: BUSINESSES.neptune_performance.color }}>Neptune Performance by {breakdown}</div>
          {neptuneByCat.length === 0 ? (
            <p style={styles.emptyText}>No Neptune {noun} yet.</p>
          ) : (
            <CategoryDonut data={neptuneByCat} total={neptuneTotal} />
          )}
        </div>
      </div>
    </>
  );
}

// Overview tab: the same three sub-views, each rendering the full Overview
// dashboard scoped to that business ("Overall" = both businesses combined).
function OverviewView({ revenue, revenuePrev, expenses, expensesPrev }) {
  const [subTab, setSubTab] = useState('all');

  const scope = (rows) => (subTab === 'all' ? rows : rows.filter(t => (t.business || 'mayday_media') === subTab));
  const rev     = useMemo(() => scope(revenue), [revenue, subTab]);
  const revPrev = useMemo(() => scope(revenuePrev), [revenuePrev, subTab]);
  const exp     = useMemo(() => scope(expenses), [expenses, subTab]);
  const expPrev = useMemo(() => scope(expensesPrev), [expensesPrev, subTab]);

  return (
    <>
      <BusinessSubTabs subTab={subTab} setSubTab={setSubTab} />
      <OverviewTab revenue={rev} revenuePrev={revPrev} expenses={exp} expensesPrev={expPrev} />
    </>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const fmtDollars = (v) => '$' + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function pctOfTotal(part, total) {
  if (!total) return '';
  return `${Math.round((part / total) * 100)}% of total`;
}

// Build a category→{label,color} map for a business whose categories aren't in
// a fixed meta map (Neptune). Colors are assigned by sorted category name so
// they stay stable across renders.
function buildDynamicMeta(rows) {
  const cats = Array.from(new Set(rows.map(t => t.category || 'Uncategorized'))).sort();
  const meta = {};
  cats.forEach((c, i) => { meta[c] = { label: c, color: DYNAMIC_PALETTE[i % DYNAMIC_PALETTE.length] }; });
  return meta;
}

// Daily series with one value per business, zero-filled across the combined
// date span. Powers the Mayday-vs-Neptune comparison trend.
function buildDailyByBusiness(mayday, neptune) {
  const m = {}, n = {};
  let min = null, max = null;
  const track = (d) => { if (!min || d < min) min = d; if (!max || d > max) max = d; };
  for (const t of mayday)  { const d = t.date?.slice(0, 10); if (!d) continue; m[d] = (m[d] || 0) + t.amount_cents; track(d); }
  for (const t of neptune) { const d = t.date?.slice(0, 10); if (!d) continue; n[d] = (n[d] || 0) + t.amount_cents; track(d); }
  if (!min) return [];
  const out = [];
  for (let d = min; d <= max; d = addDays(d, 1)) out.push({ date: d, mayday: m[d] || 0, neptune: n[d] || 0 });
  return out;
}

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

// Daily series, one point per calendar day from the first to the last
// transaction in the set. Days with no transactions are zero-filled so the
// line is spaced by real elapsed time, not by transaction count.
function buildDaily(rows) {
  const map = {};
  let min = null, max = null;
  for (const tx of rows) {
    const day = tx.date?.slice(0, 10);
    if (!day) continue;
    map[day] = (map[day] || 0) + tx.amount_cents;
    if (!min || day < min) min = day;
    if (!max || day > max) max = day;
  }
  if (!min) return [];
  const out = [];
  for (let day = min; day <= max; day = addDays(day, 1)) {
    out.push({ date: day, total: map[day] || 0 });
  }
  return out;
}

// Turn a daily series into a running-total series: each point holds the sum of
// every prior day plus itself ("the total with that day included"). Produces
// the smooth, climbing stock-chart line. `series` must be date-ascending.
function toCumulative(series, keys) {
  const acc = {};
  for (const k of keys) acc[k] = 0;
  return series.map(pt => {
    const next = { date: pt.date };
    for (const k of keys) { acc[k] += (pt[k] || 0); next[k] = acc[k]; }
    return next;
  });
}

function buildDailyDualSeries(revenue, expenses) {
  const rev = {}, exp = {};
  let min = null, max = null;
  const track = (day) => {
    if (!min || day < min) min = day;
    if (!max || day > max) max = day;
  };
  for (const tx of revenue)  { const day = tx.date?.slice(0, 10); if (!day) continue; rev[day] = (rev[day] || 0) + tx.amount_cents; track(day); }
  for (const tx of expenses) { const day = tx.date?.slice(0, 10); if (!day) continue; exp[day] = (exp[day] || 0) + tx.amount_cents; track(day); }
  if (!min) return [];
  const out = [];
  for (let day = min; day <= max; day = addDays(day, 1)) {
    const r = rev[day] || 0, e = exp[day] || 0;
    out.push({ date: day, revenue: r, expenses: e, net: r - e });
  }
  return out;
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
    deltaColor = good ? '#22c55e' : '#f87171';
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

// Dropdown that doubles as the chart's section title. Switches a trend chart
// between per-day totals and the cumulative running total.
function TrendModeSelect({ value, onChange }) {
  return (
    <div style={styles.trendModeWrap}>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={styles.trendModeSelect}>
        <option value="daily">Daily Trend</option>
        <option value="cumulative">Cumulative Trend</option>
      </select>
      <span style={styles.trendModeCaret}>▾</span>
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
    padding: '36px 40px 64px',
    maxWidth: '1500px',
    margin: '0 auto',
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

  subTabBar: { display: 'flex', gap: 6, marginBottom: 18, flexWrap: 'wrap' },
  subTab: {
    display: 'flex', alignItems: 'center', gap: 7,
    padding: '7px 14px', fontSize: 12.5, borderRadius: 8,
    background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.6)',
    border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer', fontFamily: 'inherit',
  },
  subTabActive: {
    background: 'rgba(99,102,241,0.16)', color: '#fff', borderColor: 'rgba(99,102,241,0.5)',
  },
  subTabDot: { width: 8, height: 8, borderRadius: '50%', display: 'inline-block', flexShrink: 0 },

  segmented: {
    display: 'inline-flex', gap: 2, marginBottom: 16, padding: 3,
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 8,
  },
  segBtn: {
    padding: '5px 14px', fontSize: 12, borderRadius: 6,
    background: 'transparent', color: 'rgba(255,255,255,0.55)',
    border: 'none', cursor: 'pointer', fontFamily: 'inherit',
  },
  segBtnActive: { background: 'rgba(99,102,241,0.25)', color: '#fff' },

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
  trendModeWrap: { position: 'relative', display: 'inline-block', marginBottom: 12 },
  trendModeSelect: {
    appearance: 'none', WebkitAppearance: 'none', MozAppearance: 'none',
    background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.85)',
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6,
    padding: '5px 26px 5px 10px', fontSize: 13, fontWeight: 600,
    fontFamily: 'inherit', cursor: 'pointer',
  },
  trendModeCaret: {
    position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)',
    fontSize: 10, color: 'rgba(255,255,255,0.5)', pointerEvents: 'none',
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
