// Transactions tab for the Accounting page. Three views (Transactions ledger,
// Category rules, Subscriptions) plus a persistent Review-inbox drawer and a
// compact CSV importer. The ledger is spreadsheet-like: sortable columns,
// search, filters, inline category edits (which create rules, like the inbox).
// Transactions already count in reports before review — the inbox is for
// corrections, not gatekeeping.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import { parseTransactionsCsv } from '../../lib/csvImport';
import { fetchAllRows } from '../../pages/analytics/utils';

const BUSINESSES = {
  mayday_media:        { label: 'Mayday', color: '#6366f1' },
  neptune_performance: { label: 'Neptune', color: '#06b6d4' },
};

const TRANSFER_CATEGORY = 'Transfer';

const VIEWS = [
  { key: 'transactions', label: 'Transactions' },
  { key: 'duplicates',   label: 'Duplicates' },
  { key: 'rules',        label: 'Rules' },
  { key: 'subscriptions', label: 'Subscriptions' },
];

function fmtMoney(cents) {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

// Signed value for display/sorting: revenue positive, expense negative
// (expense rows store outflows as positive cents).
function signedCents(row) {
  return row.kind === 'revenue' ? row.amount_cents : -row.amount_cents;
}

function compareRows(a, b, key) {
  if (key === 'amount') return signedCents(a) - signedCents(b);
  const av = a[key] ?? '';
  const bv = b[key] ?? '';
  if (typeof av === 'number' && typeof bv === 'number') return av - bv;
  return String(av).localeCompare(String(bv));
}

// ─── Sortable header cell ───────────────────────────────────
function Th({ label, sortKey, sort, onSort, align }) {
  const active = sort.key === sortKey;
  return (
    <th
      onClick={() => onSort(sortKey)}
      style={{ ...styles.th, ...(align === 'right' ? { textAlign: 'right' } : {}) }}
    >
      {label}
      <span style={{ ...styles.sortArrow, opacity: active ? 1 : 0.25 }}>
        {active && sort.dir === 'asc' ? '▲' : '▼'}
      </span>
    </th>
  );
}

function useSort(initialKey, initialDir = 'desc') {
  const [sort, setSort] = useState({ key: initialKey, dir: initialDir });
  const onSort = (key) => setSort(prev =>
    prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
  );
  return [sort, onSort];
}

// ─── Main tab ───────────────────────────────────────────────
export default function TransactionsTab({ revenueMeta, expenseMeta, onChanged }) {
  const { profile } = useAuth();
  const [rows, setRows] = useState([]);   // every transaction, tagged { uid, table, kind }
  const [rules, setRules] = useState([]);
  const [dismissals, setDismissals] = useState([]); // duplicate groups marked "not duplicates"
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [view, setView] = useState('transactions');
  const [drawerOpen, setDrawerOpen] = useState(false);

  const load = useCallback(async () => {
    const cols = 'id, date, description, category, amount_cents, account, business, source, review_status, is_transfer, is_duplicate';
    const [revRows, expRows, rulesRes, dismissRes] = await Promise.all([
      fetchAllRows(supabase.from('revenue_transactions').select(cols).order('date', { ascending: false })),
      fetchAllRows(supabase.from('expense_transactions').select(cols).order('date', { ascending: false })),
      supabase.from('category_rules').select('*').order('created_at', { ascending: false }),
      supabase.from('duplicate_dismissals').select('*'),
    ]);
    setRows([
      ...revRows.map(r => ({ ...r, uid: `rev_${r.id}`, table: 'revenue_transactions', kind: 'revenue' })),
      ...expRows.map(r => ({ ...r, uid: `exp_${r.id}`, table: 'expense_transactions', kind: 'expense' })),
    ]);
    setRules(rulesRes.data || []);
    setDismissals(dismissRes.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const inbox = useMemo(
    () => rows.filter(r => r.review_status === 'auto' && !r.is_duplicate).sort((a, b) => (a.date < b.date ? 1 : -1)),
    [rows]
  );

  const [dupSameDayOnly, setDupSameDayOnly] = useState(false);
  const dupGroups = useMemo(() => {
    const dismissed = new Set(dismissals.map(d => d.group_key));
    return findDuplicateGroups(rows, dismissed, dupSameDayOnly ? 0 : DUP_WINDOW_DAYS);
  }, [rows, dismissals, dupSameDayOnly]);

  const flaggedDuplicates = useMemo(
    () => rows.filter(r => r.is_duplicate).sort((a, b) => (a.date < b.date ? 1 : -1)),
    [rows]
  );

  // Neptune category suggestions come from whatever already exists
  const neptuneCategories = useMemo(() => {
    const cats = new Set();
    for (const r of rows) if (r.business === 'neptune_performance' && r.category) cats.add(r.category);
    return [...cats].sort();
  }, [rows]);

  function categoryOptions(row) {
    if (row.business !== 'mayday_media') return null; // freeform for Neptune
    const meta = row.kind === 'revenue' ? revenueMeta : expenseMeta;
    return [...Object.keys(meta), TRANSFER_CATEGORY, 'Uncategorized'];
  }

  async function refreshRules() {
    const { data } = await supabase.from('category_rules').select('*').order('created_at', { ascending: false });
    setRules(data || []);
  }

  // Shared by the inbox "Fix & confirm" and the ledger's inline edit. A
  // category change confirms the row and (unless it's a transfer or makeRule
  // is false) becomes an exact-match rule, mirroring the inbox default.
  async function applyCategory(row, finalCategory, { makeRule = true } = {}) {
    setError(null);
    const changed = finalCategory !== row.category;
    const isTransfer = finalCategory === TRANSFER_CATEGORY;

    const { error: upErr } = await supabase.from(row.table).update({
      category: finalCategory,
      review_status: 'confirmed',
      is_transfer: isTransfer,
      ...(changed ? { categorized_by: 'manual' } : {}),
    }).eq('id', row.id);
    if (upErr) { setError(upErr.message); return false; }

    if (changed && !isTransfer && makeRule) {
      await supabase.from('category_rules').insert({
        pattern: row.description,
        match_type: 'exact',
        txn_kind: row.kind,
        category: finalCategory,
        business: row.business,
        created_by: profile?.id || null,
      });
      refreshRules();
    }

    setRows(prev => prev.map(r => r.uid === row.uid
      ? { ...r, category: finalCategory, review_status: 'confirmed', is_transfer: isTransfer }
      : r));
    if (onChanged) onChanged();
    return true;
  }

  async function confirmAll(drafts) {
    setError(null);
    const untouched = inbox.filter(r => drafts[r.uid] == null);
    for (const table of ['revenue_transactions', 'expense_transactions']) {
      const ids = untouched.filter(r => r.table === table).map(r => r.id);
      if (ids.length === 0) continue;
      const { error: upErr } = await supabase.from(table)
        .update({ review_status: 'confirmed' }).in('id', ids);
      if (upErr) { setError(upErr.message); return; }
    }
    const confirmedUids = new Set(untouched.map(r => r.uid));
    setRows(prev => prev.map(r => confirmedUids.has(r.uid) ? { ...r, review_status: 'confirmed' } : r));
    if (onChanged) onChanged();
  }

  async function addRule(rule) {
    setError(null);
    const { error: insErr } = await supabase.from('category_rules').insert({
      pattern: rule.pattern.trim(),
      match_type: rule.match_type,
      txn_kind: rule.txn_kind,
      category: rule.category.trim(),
      business: rule.business || null,
      created_by: profile?.id || null,
    });
    if (insErr) { setError(insErr.message); return false; }
    refreshRules();
    return true;
  }

  async function deleteRule(id) {
    setRules(prev => prev.filter(r => r.id !== id));
    const { error: delErr } = await supabase.from('category_rules').delete().eq('id', id);
    if (delErr) { setError(delErr.message); refreshRules(); }
  }

  // "Keep this one": every other row in the group is the same real-world
  // transaction — soft-flag them so they drop out of totals everywhere.
  async function resolveDuplicates(group, keepUid) {
    setError(null);
    const losers = group.rows.filter(r => r.uid !== keepUid);
    for (const table of ['revenue_transactions', 'expense_transactions']) {
      const ids = losers.filter(r => r.table === table).map(r => r.id);
      if (ids.length === 0) continue;
      const { error: upErr } = await supabase.from(table)
        .update({ is_duplicate: true }).in('id', ids);
      if (upErr) { setError(upErr.message); return; }
    }
    const loserUids = new Set(losers.map(r => r.uid));
    setRows(prev => prev.map(r => loserUids.has(r.uid) ? { ...r, is_duplicate: true } : r));
    if (onChanged) onChanged();
  }

  // Flag a single row as the duplicate, leaving the rest of its group alone —
  // for groups where more than one charge is real.
  async function flagDuplicate(row) {
    setError(null);
    const { error: upErr } = await supabase.from(row.table)
      .update({ is_duplicate: true }).eq('id', row.id);
    if (upErr) { setError(upErr.message); return; }
    setRows(prev => prev.map(r => r.uid === row.uid ? { ...r, is_duplicate: true } : r));
    if (onChanged) onChanged();
  }

  async function dismissDuplicateGroup(group) {
    setError(null);
    const { data, error: insErr } = await supabase.from('duplicate_dismissals')
      .insert({ group_key: group.key, created_by: profile?.id || null })
      .select().single();
    if (insErr) { setError(insErr.message); return; }
    setDismissals(prev => [...prev, data]);
  }

  async function restoreDuplicate(row) {
    setError(null);
    const { error: upErr } = await supabase.from(row.table)
      .update({ is_duplicate: false }).eq('id', row.id);
    if (upErr) { setError(upErr.message); return; }
    setRows(prev => prev.map(r => r.uid === row.uid ? { ...r, is_duplicate: false } : r));
    if (onChanged) onChanged();
  }

  if (loading) return <p style={styles.emptyText}>Loading…</p>;

  return (
    <div>
      {error && <div style={styles.errorBanner}>{error}</div>}

      {/* ── Top bar: view tabs + Import CSV ── */}
      <div style={styles.topBar}>
        <div style={styles.viewTabs}>
          {VIEWS.map(v => (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              style={{ ...styles.viewTab, ...(view === v.key ? styles.viewTabActive : {}) }}
            >
              {v.label}
              {v.key === 'duplicates' && dupGroups.length > 0 && (
                <span style={styles.dupTabBadge}>{dupGroups.length}</span>
              )}
            </button>
          ))}
        </div>
        <CsvImport onImported={() => { load(); if (onChanged) onChanged(); }} />
      </div>

      {/* ── Review inbox drawer (always visible) ── */}
      <InboxDrawer
        inbox={inbox}
        open={drawerOpen}
        onToggle={() => setDrawerOpen(v => !v)}
        categoryOptions={categoryOptions}
        neptuneCategories={neptuneCategories}
        onConfirm={applyCategory}
        onConfirmAll={confirmAll}
      />

      {view === 'transactions' && (
        <LedgerView
          rows={rows}
          categoryOptions={categoryOptions}
          neptuneCategories={neptuneCategories}
          onEditCategory={applyCategory}
        />
      )}
      {view === 'duplicates' && (
        <DuplicatesView
          groups={dupGroups}
          flagged={flaggedDuplicates}
          sameDayOnly={dupSameDayOnly}
          onSameDayChange={setDupSameDayOnly}
          onResolve={resolveDuplicates}
          onFlagOne={flagDuplicate}
          onDismiss={dismissDuplicateGroup}
          onRestore={restoreDuplicate}
        />
      )}
      {view === 'rules' && (
        <RulesView rules={rules} onAdd={addRule} onDelete={deleteRule} />
      )}
      {view === 'subscriptions' && <SubscriptionsView rows={rows} />}
    </div>
  );
}

// ─── Transactions ledger ────────────────────────────────────
function LedgerView({ rows, categoryOptions, neptuneCategories, onEditCategory }) {
  const [sort, onSort] = useSort('date');
  const [search, setSearch] = useState('');
  const [fBusiness, setFBusiness] = useState('all');
  const [fCategory, setFCategory] = useState('all');
  const [fKind, setFKind] = useState('all');
  const [editingUid, setEditingUid] = useState(null);

  const allCategories = useMemo(
    () => [...new Set(rows.map(r => r.category).filter(Boolean))].sort(),
    [rows]
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    // Resolved duplicates are hidden here entirely — they live in the
    // Duplicates view's "Resolved duplicates" list.
    let out = rows.filter(r =>
      !r.is_duplicate &&
      (fBusiness === 'all' || r.business === fBusiness) &&
      (fCategory === 'all' || r.category === fCategory) &&
      (fKind === 'all' || r.kind === fKind) &&
      (!q || (r.description || '').toLowerCase().includes(q) || (r.account || '').toLowerCase().includes(q))
    );
    out = [...out].sort((a, b) => compareRows(a, b, sort.key === 'amount' ? 'amount' : sort.key));
    if (sort.dir === 'desc') out.reverse();
    return out;
  }, [rows, search, fBusiness, fCategory, fKind, sort]);

  const netCents = useMemo(() => visible.reduce((s, r) => s + (r.is_transfer ? 0 : signedCents(r)), 0), [visible]);

  return (
    <div>
      <div style={styles.filterBar}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search description or account…"
          style={{ ...styles.categoryInput, flex: 1, maxWidth: 320 }}
        />
        <select value={fBusiness} onChange={e => setFBusiness(e.target.value)} style={styles.categorySelect}>
          <option value="all">All businesses</option>
          <option value="mayday_media">Mayday</option>
          <option value="neptune_performance">Neptune</option>
        </select>
        <select value={fKind} onChange={e => setFKind(e.target.value)} style={styles.categorySelect}>
          <option value="all">Revenue + Expense</option>
          <option value="revenue">Revenue</option>
          <option value="expense">Expense</option>
        </select>
        <select value={fCategory} onChange={e => setFCategory(e.target.value)} style={styles.categorySelect}>
          <option value="all">All categories</option>
          {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <span style={styles.filterSummary}>
          {visible.length.toLocaleString()} transactions · net{' '}
          <span style={{ color: netCents >= 0 ? '#22c55e' : '#f87171', fontWeight: 700 }}>
            {fmtMoney(netCents)}
          </span>
        </span>
      </div>

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <Th label="Date" sortKey="date" sort={sort} onSort={onSort} />
              <Th label="Description" sortKey="description" sort={sort} onSort={onSort} />
              <Th label="Category" sortKey="category" sort={sort} onSort={onSort} />
              <Th label="Amount" sortKey="amount" sort={sort} onSort={onSort} align="right" />
              <Th label="Account" sortKey="account" sort={sort} onSort={onSort} />
              <Th label="Business" sortKey="business" sort={sort} onSort={onSort} />
              <Th label="Source" sortKey="source" sort={sort} onSort={onSort} />
              <Th label="Status" sortKey="review_status" sort={sort} onSort={onSort} />
            </tr>
          </thead>
          <tbody>
            {visible.map(row => {
              const signed = signedCents(row);
              return (
                <tr key={row.uid} style={styles.tr}>
                  <td style={{ ...styles.td, ...styles.tdMono, whiteSpace: 'nowrap' }}>{row.date}</td>
                  <td style={{ ...styles.td, maxWidth: 340 }} title={row.description}>
                    <div style={styles.tdEllipsis}>{row.description}</div>
                  </td>
                  <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                    {editingUid === row.uid ? (
                      <InlineCategoryEditor
                        row={row}
                        options={categoryOptions(row)}
                        neptuneCategories={neptuneCategories}
                        onDone={() => setEditingUid(null)}
                        onCommit={(cat) => { setEditingUid(null); if (cat !== row.category) onEditCategory(row, cat); }}
                      />
                    ) : (
                      <span
                        onClick={() => setEditingUid(row.uid)}
                        style={styles.categoryCell}
                        title="Click to edit category"
                      >
                        {row.category}{row.is_transfer ? ' ⇄' : ''}
                      </span>
                    )}
                  </td>
                  <td style={{ ...styles.td, ...styles.tdMono, textAlign: 'right', whiteSpace: 'nowrap', color: signed >= 0 ? '#22c55e' : '#f87171', opacity: row.is_transfer ? 0.5 : 1 }}>
                    {signed >= 0 ? '+' : '−'}{fmtMoney(Math.abs(signed))}
                  </td>
                  <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{row.account}</td>
                  <td style={{ ...styles.td, whiteSpace: 'nowrap', color: BUSINESSES[row.business]?.color }}>
                    {BUSINESSES[row.business]?.label || row.business}
                  </td>
                  <td style={{ ...styles.td, ...styles.tdDim, whiteSpace: 'nowrap' }}>{row.source}</td>
                  <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                    {row.review_status === 'auto'
                      ? <span style={styles.statusReview}>review</span>
                      : <span style={styles.statusOk}>✓</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {visible.length === 0 && <p style={styles.emptyText}>No transactions match.</p>}
      </div>
    </div>
  );
}

function InlineCategoryEditor({ row, options, neptuneCategories, onCommit, onDone }) {
  const [value, setValue] = useState(row.category);
  if (options) {
    return (
      <select
        autoFocus
        value={value}
        onChange={e => onCommit(e.target.value)}
        onBlur={onDone}
        onKeyDown={e => { if (e.key === 'Escape') onDone(); }}
        style={styles.categorySelect}
      >
        {!options.includes(value) && <option value={value}>{value}</option>}
        {options.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
    );
  }
  return (
    <>
      <input
        autoFocus
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={onDone}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); onCommit(value.trim() || row.category); }
          if (e.key === 'Escape') onDone();
        }}
        list="neptune-categories-ledger"
        style={styles.categoryInput}
      />
      <datalist id="neptune-categories-ledger">
        {neptuneCategories.map(c => <option key={c} value={c} />)}
      </datalist>
    </>
  );
}

// ─── Rules view ─────────────────────────────────────────────
function RulesView({ rules, onAdd, onDelete }) {
  const [sort, onSort] = useSort('created_at');
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState({ pattern: '', match_type: 'contains', txn_kind: 'expense', category: '', business: '' });

  const sorted = useMemo(() => {
    const out = [...rules].sort((a, b) => compareRows(a, b, sort.key));
    if (sort.dir === 'desc') out.reverse();
    return out;
  }, [rules, sort]);

  async function submit() {
    if (!draft.pattern.trim() || !draft.category.trim()) return;
    if (await onAdd(draft)) {
      setDraft({ pattern: '', match_type: 'contains', txn_kind: 'expense', category: '', business: '' });
      setShowAdd(false);
    }
  }

  return (
    <div>
      <div style={styles.viewHeader}>
        <h2 style={styles.sectionTitle}>Category rules</h2>
        <span style={styles.sectionCount}>{rules.length}</span>
        <button onClick={() => setShowAdd(v => !v)} style={{ ...styles.confirmBtn, marginLeft: 'auto' }}>
          {showAdd ? 'Cancel' : '+ Add rule'}
        </button>
      </div>

      {showAdd && (
        <div style={styles.newRuleRow}>
          <input
            placeholder="Merchant pattern (e.g. ADOBE)"
            value={draft.pattern}
            onChange={e => setDraft(r => ({ ...r, pattern: e.target.value }))}
            style={{ ...styles.categoryInput, flex: 2 }}
          />
          <select value={draft.match_type} onChange={e => setDraft(r => ({ ...r, match_type: e.target.value }))} style={styles.categorySelect}>
            <option value="contains">contains</option>
            <option value="exact">exact</option>
          </select>
          <select value={draft.txn_kind} onChange={e => setDraft(r => ({ ...r, txn_kind: e.target.value }))} style={styles.categorySelect}>
            <option value="expense">expense</option>
            <option value="revenue">revenue</option>
          </select>
          <select value={draft.business} onChange={e => setDraft(r => ({ ...r, business: e.target.value }))} style={styles.categorySelect}>
            <option value="">any business</option>
            <option value="mayday_media">Mayday</option>
            <option value="neptune_performance">Neptune</option>
          </select>
          <input
            placeholder="Category"
            value={draft.category}
            onChange={e => setDraft(r => ({ ...r, category: e.target.value }))}
            style={{ ...styles.categoryInput, flex: 1 }}
          />
          <button onClick={submit} style={styles.confirmBtn}>Save rule</button>
        </div>
      )}

      {rules.length === 0 ? (
        <p style={styles.emptyText}>No rules yet. Fixing a category in the inbox creates one automatically.</p>
      ) : (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <Th label="Pattern" sortKey="pattern" sort={sort} onSort={onSort} />
                <Th label="Match" sortKey="match_type" sort={sort} onSort={onSort} />
                <Th label="Kind" sortKey="txn_kind" sort={sort} onSort={onSort} />
                <Th label="Business" sortKey="business" sort={sort} onSort={onSort} />
                <Th label="Category" sortKey="category" sort={sort} onSort={onSort} />
                <Th label="Priority" sortKey="priority" sort={sort} onSort={onSort} align="right" />
                <th style={styles.th} />
              </tr>
            </thead>
            <tbody>
              {sorted.map(rule => (
                <tr key={rule.id} style={styles.tr}>
                  <td style={{ ...styles.td, fontFamily: 'monospace', maxWidth: 380 }} title={rule.pattern}>
                    <div style={styles.tdEllipsis}>{rule.pattern}</div>
                  </td>
                  <td style={{ ...styles.td, ...styles.tdDim }}>{rule.match_type}</td>
                  <td style={{ ...styles.td, ...styles.tdDim }}>{rule.txn_kind}</td>
                  <td style={{ ...styles.td, whiteSpace: 'nowrap', color: rule.business ? BUSINESSES[rule.business]?.color : 'rgba(255,255,255,0.4)' }}>
                    {rule.business ? BUSINESSES[rule.business]?.label : 'any'}
                  </td>
                  <td style={{ ...styles.td, color: '#a5b4fc', fontWeight: 600 }}>{rule.category}</td>
                  <td style={{ ...styles.td, ...styles.tdMono, textAlign: 'right' }}>{rule.priority ?? 0}</td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>
                    <button onClick={() => onDelete(rule.id)} style={styles.deleteBtn} title="Delete rule">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Subscriptions view ─────────────────────────────────────
// Auto-detects recurring merchants: same description ≥3 times at a roughly
// regular interval. Catches subscriptions regardless of category.
const FREQ_LABELS = [
  { max: 9,   label: 'Weekly',    perMonth: 4.33 },
  { max: 19,  label: 'Biweekly',  perMonth: 2.17 },
  { max: 45,  label: 'Monthly',   perMonth: 1 },
  { max: 135, label: 'Quarterly', perMonth: 1 / 3 },
  { max: 400, label: 'Annual',    perMonth: 1 / 12 },
];

// Expense transactions grouped by '<business>|<description>' — the key that
// subscription_overrides.member_keys references.
function groupExpenseTxs(rows) {
  const groups = new Map();
  for (const r of rows) {
    if (r.kind !== 'expense' || r.is_transfer || r.is_duplicate) continue;
    if (!(r.description || '').trim()) continue;
    const key = `${r.business}|${(r.description || '').trim()}`;
    (groups.get(key) ?? groups.set(key, []).get(key)).push(r);
  }
  return groups;
}

// Stats for one (possibly merged) group of charges. With requireRegular, a
// group only qualifies if it has 3+ charges at a roughly steady cadence —
// median absolute deviation within 35% of the cadence (or a week, whichever
// is looser — bank posting dates wobble). Merged groups skip the gate: the
// user has already declared them a subscription.
function computeSubStats(txs, { requireRegular = true } = {}) {
  if (txs.length < 3) return null;
  const dates = txs.map(t => t.date).sort();
  const intervals = [];
  for (let i = 1; i < dates.length; i++) {
    intervals.push((new Date(dates[i]) - new Date(dates[i - 1])) / 86400000);
  }
  const sortedIv = [...intervals].sort((a, b) => a - b);
  const median = sortedIv[Math.floor(sortedIv.length / 2)];
  if (requireRegular) {
    if (median < 5 || median > 400) return null;
    const mad = intervals.map(iv => Math.abs(iv - median)).sort((a, b) => a - b)[Math.floor(intervals.length / 2)];
    if (mad > Math.max(7, median * 0.35)) return null;
  }

  const freq = FREQ_LABELS.find(f => median <= f.max)
    || { label: `~${Math.max(1, Math.round(median))}d`, perMonth: median > 0 ? 30 / median : 1 };
  const avgCents = Math.round(txs.reduce((s, t) => s + t.amount_cents, 0) / txs.length);
  const catCounts = {};
  for (const t of txs) catCounts[t.category] = (catCounts[t.category] || 0) + 1;
  const category = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0][0];

  return {
    category,
    count: txs.length,
    frequency: freq.label,
    median_days: median,
    avg_cents: avgCents,
    monthly_cents: Math.round(avgCents * freq.perMonth),
    last_date: dates[dates.length - 1],
  };
}

function SubscriptionsView({ rows }) {
  const { profile } = useAuth();
  const [sort, onSort] = useSort('monthly_cents');
  const [overrides, setOverrides] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [mergeName, setMergeName] = useState(null); // null = merge bar hidden
  const [showHidden, setShowHidden] = useState(false);

  useEffect(() => {
    supabase.from('subscription_overrides').select('*')
      .then(({ data }) => setOverrides(data || []));
  }, []);

  const groups = useMemo(() => groupExpenseTxs(rows), [rows]);

  const { subs, hidden } = useMemo(() => {
    const hideOverrides = overrides.filter(o => o.kind === 'hide');
    const hiddenKeys = new Set(hideOverrides.flatMap(o => o.member_keys));
    const mergedKeys = new Set(overrides.filter(o => o.kind === 'merge').flatMap(o => o.member_keys));

    const out = [];
    // Merged groups: combine every member's charges, skip the regularity gate.
    for (const ov of overrides) {
      if (ov.kind !== 'merge') continue;
      const txs = ov.member_keys.flatMap(k => groups.get(k) || []);
      const stats = computeSubStats(txs, { requireRegular: false });
      if (!stats) continue;
      const businesses = [...new Set(ov.member_keys.map(k => k.split('|')[0]))];
      out.push({
        ...stats,
        id: `merge_${ov.id}`,
        overrideId: ov.id,
        merged: true,
        description: ov.name || ov.member_keys[0].split('|').slice(1).join('|'),
        business: businesses.length === 1 ? businesses[0] : 'mixed',
      });
    }
    // Plain detected groups: not hidden, not absorbed into a merge.
    for (const [key, txs] of groups) {
      if (hiddenKeys.has(key) || mergedKeys.has(key)) continue;
      const stats = computeSubStats(txs);
      if (!stats) continue;
      out.push({
        ...stats,
        id: key,
        key,
        merged: false,
        description: key.split('|').slice(1).join('|'),
        business: key.split('|')[0],
      });
    }
    return { subs: out, hidden: hideOverrides };
  }, [groups, overrides]);

  const sorted = useMemo(() => {
    const out = [...subs].sort((a, b) => compareRows(a, b, sort.key));
    if (sort.dir === 'desc') out.reverse();
    return out;
  }, [subs, sort]);

  const totalMonthly = subs.reduce((s, x) => s + x.monthly_cents, 0);

  function toggleSelect(key) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  async function saveOverride(override) {
    const { data, error } = await supabase.from('subscription_overrides')
      .insert({ ...override, created_by: profile?.id || null })
      .select().single();
    if (!error && data) setOverrides(prev => [...prev, data]);
  }

  async function removeOverride(id) {
    setOverrides(prev => prev.filter(o => o.id !== id));
    await supabase.from('subscription_overrides').delete().eq('id', id);
  }

  async function commitMerge() {
    const keys = [...selected];
    if (keys.length < 2) return;
    await saveOverride({ kind: 'merge', name: mergeName?.trim() || null, member_keys: keys });
    setSelected(new Set());
    setMergeName(null);
  }

  // Default merged name: shortest member description reads most like the brand.
  function openMergeBar() {
    const descs = [...selected].map(k => k.split('|').slice(1).join('|'));
    setMergeName(descs.sort((a, b) => a.length - b.length)[0] || '');
  }

  return (
    <div>
      <div style={styles.viewHeader}>
        <h2 style={styles.sectionTitle}>Subscriptions</h2>
        <span style={styles.sectionCount}>{subs.length}</span>
        {selected.size >= 2 && mergeName === null && (
          <button onClick={openMergeBar} style={styles.confirmBtn}>
            Merge {selected.size} selected
          </button>
        )}
        <span style={{ ...styles.filterSummary, marginLeft: 'auto' }}>
          ≈ <span style={{ color: '#f87171', fontWeight: 700 }}>{fmtMoney(totalMonthly)}</span>/month
        </span>
      </div>
      <p style={styles.subHint}>
        Recurring charges auto-detected from the ledger: same merchant, 3+ charges at a regular cadence.
        Select rows to merge descriptor variants of one service; ✕ dismisses a false positive.
      </p>

      {mergeName !== null && (
        <div style={styles.mergeBar}>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>Merged name:</span>
          <input
            autoFocus
            value={mergeName}
            onChange={e => setMergeName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') commitMerge(); if (e.key === 'Escape') setMergeName(null); }}
            style={{ ...styles.categoryInput, flex: 1, maxWidth: 300 }}
          />
          <button onClick={commitMerge} style={styles.confirmBtn}>Merge {selected.size}</button>
          <button onClick={() => setMergeName(null)} style={styles.importPickBtn}>Cancel</button>
        </div>
      )}

      {subs.length === 0 ? (
        <p style={styles.emptyText}>No recurring charges detected yet.</p>
      ) : (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={{ ...styles.th, cursor: 'default', width: 28 }} />
                <Th label="Merchant" sortKey="description" sort={sort} onSort={onSort} />
                <Th label="Category" sortKey="category" sort={sort} onSort={onSort} />
                <Th label="Business" sortKey="business" sort={sort} onSort={onSort} />
                <Th label="Frequency" sortKey="median_days" sort={sort} onSort={onSort} />
                <Th label="Charges" sortKey="count" sort={sort} onSort={onSort} align="right" />
                <Th label="Avg cost" sortKey="avg_cents" sort={sort} onSort={onSort} align="right" />
                <Th label="≈ Monthly" sortKey="monthly_cents" sort={sort} onSort={onSort} align="right" />
                <Th label="Last charge" sortKey="last_date" sort={sort} onSort={onSort} />
                <th style={{ ...styles.th, cursor: 'default' }} />
              </tr>
            </thead>
            <tbody>
              {sorted.map(sub => (
                <tr key={sub.id} style={styles.tr}>
                  <td style={{ ...styles.td, textAlign: 'center' }}>
                    {!sub.merged && (
                      <input
                        type="checkbox"
                        checked={selected.has(sub.key)}
                        onChange={() => toggleSelect(sub.key)}
                        style={{ cursor: 'pointer' }}
                      />
                    )}
                  </td>
                  <td style={{ ...styles.td, maxWidth: 340 }} title={sub.description}>
                    <div style={styles.tdEllipsis}>
                      {sub.description}
                      {sub.merged && <span style={styles.mergedBadge}>merged</span>}
                    </div>
                  </td>
                  <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{sub.category}</td>
                  <td style={{ ...styles.td, whiteSpace: 'nowrap', color: BUSINESSES[sub.business]?.color }}>
                    {sub.business === 'mixed' ? 'Both' : (BUSINESSES[sub.business]?.label || sub.business)}
                  </td>
                  <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{sub.frequency}</td>
                  <td style={{ ...styles.td, ...styles.tdMono, textAlign: 'right' }}>{sub.count}</td>
                  <td style={{ ...styles.td, ...styles.tdMono, textAlign: 'right', color: '#f87171' }}>{fmtMoney(sub.avg_cents)}</td>
                  <td style={{ ...styles.td, ...styles.tdMono, textAlign: 'right' }}>{fmtMoney(sub.monthly_cents)}</td>
                  <td style={{ ...styles.td, ...styles.tdMono, whiteSpace: 'nowrap' }}>{sub.last_date}</td>
                  <td style={{ ...styles.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {sub.merged ? (
                      <button onClick={() => removeOverride(sub.overrideId)} style={styles.deleteBtn} title="Unmerge">unmerge</button>
                    ) : (
                      <button
                        onClick={() => saveOverride({ kind: 'hide', name: null, member_keys: [sub.key] })}
                        style={styles.deleteBtn}
                        title="Not a subscription — hide"
                      >✕</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {hidden.length > 0 && (
        <div style={styles.hiddenFooter}>
          <button onClick={() => setShowHidden(v => !v)} style={styles.importPickBtn}>
            {showHidden ? 'Hide' : `Show ${hidden.length} dismissed`}
          </button>
          {showHidden && hidden.map(o => (
            <span key={o.id} style={styles.hiddenChip}>
              {o.member_keys[0].split('|').slice(1).join('|')}
              <button onClick={() => removeOverride(o.id)} style={{ ...styles.deleteBtn, padding: '0 2px' }} title="Restore">↩</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Duplicate detection ────────────────────────────────────
// Candidates: same kind + business + exact amount, dates within a few days.
// That alone over-matches (recurring identical charges), so a group only
// qualifies when some pair also looks like the same real-world transaction:
// matching merchant descriptions, or different feed sources (Tiller/Plaid/CSV
// overlap — the most common way duplicates actually get in).
const DUP_WINDOW_DAYS = 3;
const CONF_RANK = { possible: 0, medium: 1, high: 2 };
const CONF_META = {
  high:     { label: 'likely',   color: '#f87171' },
  medium:   { label: 'probable', color: '#fbbf24' },
  possible: { label: 'possible', color: 'rgba(255,255,255,0.5)' },
};

// Merchant descriptors vary in casing/punctuation/trailing reference numbers
// between feeds — compare only the letters.
function normDesc(s) {
  return (s || '').toLowerCase().replace(/[^a-z]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function descsSimilar(a, b) {
  const na = normDesc(a), nb = normDesc(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return (na.length >= 5 && nb.includes(na)) || (nb.length >= 5 && na.includes(nb));
}

function dayDiff(a, b) {
  return Math.abs(new Date(a) - new Date(b)) / 86400000;
}

function pairConfidence(a, b, windowDays) {
  if (dayDiff(a.date, b.date) > windowDays) return null;
  const similar = descsSimilar(a.description, b.description);
  const crossSource = a.source !== b.source;
  if (similar && (a.date === b.date || crossSource)) return 'high';
  if (similar) return 'medium';
  if (crossSource) return 'possible';
  return null; // same source, different merchants — coincidental same amount
}

// windowDays 0 = "same day only" mode.
function findDuplicateGroups(rows, dismissedKeys, windowDays = DUP_WINDOW_DAYS) {
  const buckets = new Map();
  for (const r of rows) {
    if (r.is_duplicate || r.is_transfer || !r.amount_cents) continue;
    const key = `${r.kind}|${r.business}|${r.amount_cents}`;
    (buckets.get(key) ?? buckets.set(key, []).get(key)).push(r);
  }

  const groups = [];
  const pushCluster = (cluster) => {
    if (cluster.length < 2) return;
    let best = null;
    for (let i = 0; i < cluster.length; i++) {
      for (let j = i + 1; j < cluster.length; j++) {
        const c = pairConfidence(cluster[i], cluster[j], windowDays);
        if (c && (!best || CONF_RANK[c] > CONF_RANK[best])) best = c;
      }
    }
    if (!best) return;
    // Key = sorted member uids: if a new row later joins this cluster, the
    // key changes and a dismissed group correctly resurfaces.
    const key = cluster.map(r => r.uid).sort().join('+');
    if (dismissedKeys.has(key)) return;
    groups.push({ key, rows: cluster, confidence: best });
  };

  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;
    bucket.sort((a, b) => a.date.localeCompare(b.date));
    let cluster = [bucket[0]];
    for (let i = 1; i < bucket.length; i++) {
      if (dayDiff(bucket[i].date, cluster[cluster.length - 1].date) <= windowDays) {
        cluster.push(bucket[i]);
      } else {
        pushCluster(cluster);
        cluster = [bucket[i]];
      }
    }
    pushCluster(cluster);
  }

  groups.sort((a, b) =>
    CONF_RANK[b.confidence] - CONF_RANK[a.confidence]
    || b.rows[0].date.localeCompare(a.rows[0].date));
  return groups;
}

// ─── Duplicates view ────────────────────────────────────────
function DuplicatesView({ groups, flagged, sameDayOnly, onSameDayChange, onResolve, onFlagOne, onDismiss, onRestore }) {
  const [showResolved, setShowResolved] = useState(false);

  const atRiskCents = groups.reduce(
    (s, g) => s + Math.abs(g.rows[0].amount_cents) * (g.rows.length - 1), 0);

  return (
    <div>
      <div style={styles.viewHeader}>
        <h2 style={styles.sectionTitle}>Potential duplicates</h2>
        <span style={styles.sectionCount}>{groups.length}</span>
        <label style={{ ...styles.ruleCheck, marginLeft: 8 }}>
          <input
            type="checkbox"
            checked={sameDayOnly}
            onChange={e => onSameDayChange(e.target.checked)}
          />
          same-day only
        </label>
        {groups.length > 0 && (
          <span style={{ ...styles.filterSummary, marginLeft: 'auto' }}>
            up to <span style={{ color: '#fbbf24', fontWeight: 700 }}>{fmtMoney(atRiskCents)}</span> double-counted
          </span>
        )}
      </div>
      <p style={styles.subHint}>
        Same amount and business {sameDayOnly ? 'on the same day' : `within ${DUP_WINDOW_DAYS} days`}, with matching merchants or
        different feed sources (Tiller / Plaid / CSV overlap). Three ways to resolve a group:
        <b style={styles.hintKey}> Keep</b> one row (flags every other row as a duplicate) ·
        <b style={styles.hintKey}> Flag as dup</b> on just the bogus row (leaves the rest alone) ·
        <b style={styles.hintKey}> Not duplicates</b> (all charges are real — dismisses the group for good).
        Flagged rows are hidden from the ledger and excluded from all totals and reports;
        they live in the resolved list below, where they can be restored.
      </p>

      {groups.length === 0 ? (
        <p style={styles.emptyText}>No potential duplicates detected. 🎉</p>
      ) : (
        groups.map(g => {
          const conf = CONF_META[g.confidence];
          const first = g.rows[0];
          return (
            <div key={g.key} style={styles.dupGroup}>
              <div style={styles.dupGroupHeader}>
                <span style={{ ...styles.dupConfChip, color: conf.color, borderColor: conf.color + '66' }}>
                  {conf.label}
                </span>
                <span style={{
                  fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                  color: first.kind === 'revenue' ? '#22c55e' : '#f87171',
                }}>
                  {first.kind === 'revenue' ? '+' : '−'}{fmtMoney(Math.abs(first.amount_cents))}
                </span>
                <span style={{ fontSize: 12, color: BUSINESSES[first.business]?.color }}>
                  {BUSINESSES[first.business]?.label || first.business}
                </span>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
                  ×{g.rows.length}
                </span>
                <button onClick={() => onDismiss(g)} style={{ ...styles.importPickBtn, marginLeft: 'auto' }}>
                  Not duplicates
                </button>
              </div>
              <table style={styles.table}>
                <tbody>
                  {g.rows.map(row => (
                    <tr key={row.uid} style={styles.tr}>
                      <td style={{ ...styles.td, ...styles.tdMono, whiteSpace: 'nowrap', width: 90 }}>{row.date}</td>
                      <td style={{ ...styles.td, maxWidth: 340 }} title={row.description}>
                        <div style={styles.tdEllipsis}>{row.description}</div>
                      </td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{row.account}</td>
                      <td style={{ ...styles.td, ...styles.tdDim, whiteSpace: 'nowrap' }}>{row.source}</td>
                      <td style={{ ...styles.td, ...styles.tdDim, whiteSpace: 'nowrap' }}>{row.category}</td>
                      <td style={{ ...styles.td, textAlign: 'right', whiteSpace: 'nowrap', width: 180 }}>
                        <button
                          onClick={() => onResolve(g, row.uid)}
                          style={styles.keepBtn}
                          title="This is the real one — flag every other row in this group as a duplicate"
                        >
                          Keep
                        </button>
                        <button
                          onClick={() => onFlagOne(row)}
                          style={styles.flagBtn}
                          title="This row is the duplicate — flag just this one, keep the rest"
                        >
                          Flag as dup
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })
      )}

      <div style={styles.hiddenFooter}>
        <button onClick={() => setShowResolved(v => !v)} style={styles.importPickBtn}>
          {showResolved ? 'Hide resolved' : `Resolved duplicates (${flagged.length})`}
        </button>
      </div>
      {showResolved && (
        flagged.length === 0 ? (
          <p style={styles.emptyText}>Nothing has been flagged as a duplicate yet.</p>
        ) : (
          <div style={{ ...styles.tableWrap, marginTop: 10 }}>
            <table style={styles.table}>
              <tbody>
                {flagged.map(row => (
                  <tr key={row.uid} style={{ ...styles.tr, opacity: 0.65 }}>
                    <td style={{ ...styles.td, ...styles.tdMono, whiteSpace: 'nowrap', width: 90 }}>{row.date}</td>
                    <td style={{ ...styles.td, maxWidth: 340 }} title={row.description}>
                      <div style={styles.tdEllipsis}>{row.description}</div>
                    </td>
                    <td style={{ ...styles.td, ...styles.tdMono, textAlign: 'right', whiteSpace: 'nowrap', color: row.kind === 'revenue' ? '#22c55e' : '#f87171' }}>
                      {row.kind === 'revenue' ? '+' : '−'}{fmtMoney(Math.abs(row.amount_cents))}
                    </td>
                    <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{row.account}</td>
                    <td style={{ ...styles.td, ...styles.tdDim, whiteSpace: 'nowrap' }}>{row.source}</td>
                    <td style={{ ...styles.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button onClick={() => onRestore(row)} style={styles.deleteBtn} title="Not a duplicate — restore to totals">↩ restore</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}

// ─── Review inbox drawer ────────────────────────────────────
function InboxDrawer({ inbox, open, onToggle, categoryOptions, neptuneCategories, onConfirm, onConfirmAll }) {
  const [makeRule, setMakeRule] = useState({}); // uid -> bool (default true when edited)
  const [drafts, setDrafts] = useState({});     // uid -> draft category

  return (
    <div style={styles.drawer}>
      <button onClick={onToggle} style={styles.drawerHeader}>
        <span style={{ ...styles.drawerChevron, transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
        <span style={styles.drawerTitle}>Review inbox</span>
        {inbox.length > 0 ? (
          <span style={styles.drawerBadge}>{inbox.length} to review</span>
        ) : (
          <span style={styles.drawerBadgeEmpty}>clear</span>
        )}
      </button>

      {open && (
        <div style={styles.drawerBody}>
          {inbox.length === 0 ? (
            <p style={{ ...styles.emptyText, padding: '4px 0 8px' }}>All caught up — nothing awaiting review.</p>
          ) : (
            <>
              <div style={{ display: 'flex', marginBottom: 10 }}>
                <button onClick={() => onConfirmAll(drafts)} style={{ ...styles.confirmAllBtn, marginLeft: 0 }}>
                  Confirm all unedited
                </button>
              </div>
              <div style={styles.inboxGrid}>
                {inbox.map(row => {
                  const options = categoryOptions(row);
                  const draft = drafts[row.uid] ?? row.category;
                  const edited = draft !== row.category;
                  return (
                    <div key={row.uid} style={styles.row}>
                      <div style={styles.rowMain}>
                        <span style={styles.rowDate}>{row.date}</span>
                        <span style={styles.rowDesc} title={row.description}>{row.description}</span>
                        <span style={{
                          ...styles.rowAmount,
                          color: row.kind === 'revenue' ? '#22c55e' : '#f87171',
                        }}>
                          {row.kind === 'revenue' ? '+' : '−'}{fmtMoney(row.amount_cents)}
                        </span>
                      </div>
                      <div style={styles.rowControls}>
                        <span style={{ ...styles.bizChip, color: BUSINESSES[row.business]?.color }}>
                          {BUSINESSES[row.business]?.label || row.business}
                        </span>
                        <span style={styles.rowAccount}>{row.account}</span>
                        {options ? (
                          <select
                            value={draft}
                            onChange={e => setDrafts(prev => ({ ...prev, [row.uid]: e.target.value }))}
                            style={styles.categorySelect}
                          >
                            {!options.includes(draft) && <option value={draft}>{draft}</option>}
                            {options.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        ) : (
                          <>
                            <input
                              value={draft}
                              onChange={e => setDrafts(prev => ({ ...prev, [row.uid]: e.target.value }))}
                              list="neptune-categories-inbox"
                              style={styles.categoryInput}
                            />
                            <datalist id="neptune-categories-inbox">
                              {neptuneCategories.map(c => <option key={c} value={c} />)}
                            </datalist>
                          </>
                        )}
                        {edited && draft !== TRANSFER_CATEGORY && (
                          <label style={styles.ruleCheck}>
                            <input
                              type="checkbox"
                              checked={makeRule[row.uid] ?? true}
                              onChange={e => setMakeRule(prev => ({ ...prev, [row.uid]: e.target.checked }))}
                            />
                            rule
                          </label>
                        )}
                        <button
                          onClick={() => onConfirm(row, draft, { makeRule: makeRule[row.uid] ?? true })}
                          style={styles.confirmBtn}
                        >
                          {edited ? 'Fix & confirm' : 'Confirm'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── CSV import (compact button + dropdown panel) ───────────
// Manual CSV upload — fallback ingestion when the bank feed is down or has a
// gap. Amex statement exports work out of the box (positive = charge).
function CsvImport({ onImported }) {
  const [parsed, setParsed] = useState(null); // { fileName, rows, errors }
  const [business, setBusiness] = useState('mayday_media');
  const [accountLabel, setAccountLabel] = useState('Amex Business');
  const [positiveIs, setPositiveIs] = useState('expense');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null); // response summary or { error }
  const fileRef = useRef(null);

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setResult(null);
    const reader = new FileReader();
    reader.onload = () => {
      const { rows, errors } = parseTransactionsCsv(String(reader.result));
      setParsed({ fileName: file.name, rows, errors });
    };
    reader.readAsText(file);
    e.target.value = ''; // same file re-selectable
  }

  async function runImport() {
    if (!parsed?.rows?.length) return;
    setImporting(true);
    setResult(null);
    try {
      // Chunked: the edge fn caps rows per request, and smaller batches keep
      // each call inside the function timeout when Claude categorization runs.
      const CHUNK = 500;
      const totals = { imported: 0, skipped_duplicates: 0, skipped_invalid: 0, ai_categorized: 0 };
      for (let i = 0; i < parsed.rows.length; i += CHUNK) {
        const { data, error } = await supabase.functions.invoke('import-transactions', {
          body: { rows: parsed.rows.slice(i, i + CHUNK), business, accountLabel, positiveIs },
        });
        if (error) {
          // FunctionsHttpError hides the real message in context — dig it out
          let msg = error.message;
          try {
            const body = await error.context?.json?.();
            if (body?.error) msg = body.error;
          } catch { /* keep generic message */ }
          throw new Error(msg);
        }
        totals.imported += data.imported || 0;
        totals.skipped_duplicates += data.skipped_duplicates || 0;
        totals.skipped_invalid += data.skipped_invalid || 0;
        totals.ai_categorized += data.ai_categorized || 0;
        setResult({ ...totals, progress: `${Math.min(i + CHUNK, parsed.rows.length)}/${parsed.rows.length}` });
      }
      setResult(totals);
      setParsed(null);
      onImported();
    } catch (err) {
      setResult({ error: err?.message || 'Import failed' });
    } finally {
      setImporting(false);
    }
  }

  const panelOpen = parsed || result;

  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => fileRef.current?.click()} style={styles.importPickBtn} title="Amex statement exports work as-is">
        Import CSV
      </button>
      <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={handleFile} style={{ display: 'none' }} />

      {panelOpen && (
        <div style={styles.importPanel}>
          {parsed && (
            <>
              <div style={styles.importMeta}>
                <span style={styles.importFileName}>{parsed.fileName}</span>
                <span style={styles.importCount}>{parsed.rows.length} rows parsed</span>
                {parsed.errors.length > 0 && (
                  <span style={styles.importWarn}>{parsed.errors.length} rows skipped</span>
                )}
                <button onClick={() => { setParsed(null); setResult(null); }} style={styles.deleteBtn} title="Dismiss">✕</button>
              </div>
              {parsed.rows.length > 0 && (
                <div style={styles.importControls}>
                  <select value={business} onChange={e => setBusiness(e.target.value)} style={styles.categorySelect}>
                    <option value="mayday_media">Mayday</option>
                    <option value="neptune_performance">Neptune</option>
                  </select>
                  <input
                    value={accountLabel}
                    onChange={e => setAccountLabel(e.target.value)}
                    placeholder="Account label"
                    style={styles.categoryInput}
                  />
                  <select value={positiveIs} onChange={e => setPositiveIs(e.target.value)} style={styles.categorySelect}>
                    <option value="expense">positive = charge (Amex)</option>
                    <option value="revenue">positive = income</option>
                  </select>
                  <button onClick={runImport} disabled={importing} style={styles.confirmBtn}>
                    {importing ? 'Importing…' : `Import ${parsed.rows.length} rows`}
                  </button>
                </div>
              )}
            </>
          )}
          {result && (
            <div style={result.error ? styles.importResultError : styles.importResult}>
              {result.error
                ? result.error
                : `Imported ${result.imported} · ${result.skipped_duplicates} duplicates skipped · ${result.ai_categorized} AI-categorized${result.skipped_invalid ? ` · ${result.skipped_invalid} invalid` : ''}`}
              {!parsed && (
                <button onClick={() => setResult(null)} style={{ ...styles.deleteBtn, float: 'right' }} title="Dismiss">✕</button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const styles = {
  errorBanner: {
    padding: '10px 14px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
    borderRadius: 8, color: '#fca5a5', fontSize: 13, marginBottom: 16,
  },
  emptyText: { color: 'rgba(255,255,255,0.4)', fontSize: 14, padding: '16px 0' },

  topBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  viewTabs: {
    display: 'flex', gap: 4, background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, padding: 3,
  },
  viewTab: {
    padding: '6px 14px', background: 'none', border: 'none', borderRadius: 6,
    color: 'rgba(255,255,255,0.5)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  },
  viewTabActive: { background: 'rgba(99,102,241,0.25)', color: '#c7d2fe' },

  viewHeader: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 },
  sectionTitle: { margin: 0, fontSize: 16, fontWeight: 700, color: '#fff' },
  sectionCount: {
    fontSize: 12, fontWeight: 700, color: '#a5b4fc', background: 'rgba(99,102,241,0.15)',
    padding: '2px 8px', borderRadius: 999,
  },
  confirmAllBtn: {
    marginLeft: 'auto', padding: '6px 12px', background: 'rgba(34,197,94,0.15)',
    border: '1px solid rgba(34,197,94,0.35)', borderRadius: 6, color: '#4ade80',
    fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  },

  // ── Drawer ──
  drawer: {
    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 10, marginBottom: 18, overflow: 'hidden',
  },
  drawerHeader: {
    display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 14px',
    background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
  },
  drawerChevron: {
    fontSize: 10, color: 'rgba(255,255,255,0.4)', transition: 'transform 0.15s', display: 'inline-block',
  },
  drawerTitle: { fontSize: 14, fontWeight: 700, color: '#fff' },
  drawerBadge: {
    fontSize: 11, fontWeight: 700, color: '#fbbf24', background: 'rgba(251,191,36,0.15)',
    border: '1px solid rgba(251,191,36,0.3)', padding: '2px 9px', borderRadius: 999,
  },
  drawerBadgeEmpty: {
    fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.3)',
    background: 'rgba(255,255,255,0.05)', padding: '2px 9px', borderRadius: 999,
  },
  drawerBody: { padding: '0 14px 14px' },

  // ── Tables ──
  tableWrap: {
    border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, overflow: 'auto',
    maxHeight: '65vh', background: 'rgba(255,255,255,0.02)',
  },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 },
  th: {
    position: 'sticky', top: 0, zIndex: 1, textAlign: 'left', padding: '9px 10px',
    fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
    color: 'rgba(255,255,255,0.45)', background: '#16162a', cursor: 'pointer',
    userSelect: 'none', whiteSpace: 'nowrap', borderBottom: '1px solid rgba(255,255,255,0.08)',
  },
  sortArrow: { fontSize: 8, marginLeft: 5, verticalAlign: 'middle' },
  tr: { borderBottom: '1px solid rgba(255,255,255,0.04)' },
  td: { padding: '7px 10px', color: 'rgba(255,255,255,0.78)', verticalAlign: 'middle' },
  tdMono: { fontVariantNumeric: 'tabular-nums' },
  tdDim: { color: 'rgba(255,255,255,0.38)' },
  tdEllipsis: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  categoryCell: {
    cursor: 'pointer', borderBottom: '1px dashed rgba(255,255,255,0.2)', paddingBottom: 1,
  },
  statusOk: { color: '#4ade80', fontSize: 12 },
  statusReview: {
    fontSize: 10, fontWeight: 700, color: '#fbbf24', background: 'rgba(251,191,36,0.12)',
    padding: '1px 7px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: 0.4,
  },
  // ── Duplicates view ──
  dupTabBadge: {
    marginLeft: 6, fontSize: 10, fontWeight: 700, color: '#fbbf24',
    background: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.3)',
    padding: '1px 6px', borderRadius: 999,
  },
  dupGroup: {
    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 10, marginBottom: 10, overflow: 'hidden',
  },
  dupGroupHeader: {
    display: 'flex', alignItems: 'center', gap: 12, padding: '9px 12px',
    borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)',
  },
  dupConfChip: {
    fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
    border: '1px solid', padding: '1px 8px', borderRadius: 999,
  },
  keepBtn: {
    padding: '4px 11px', background: 'rgba(34,197,94,0.15)',
    border: '1px solid rgba(34,197,94,0.35)', borderRadius: 6, color: '#4ade80',
    fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
  },
  flagBtn: {
    padding: '4px 11px', marginLeft: 6, background: 'rgba(239,68,68,0.12)',
    border: '1px solid rgba(239,68,68,0.35)', borderRadius: 6, color: '#f87171',
    fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
  },
  hintKey: { color: 'rgba(255,255,255,0.7)' },

  filterBar: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  mergeBar: {
    display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '10px 12px',
    background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 8,
  },
  mergedBadge: {
    marginLeft: 8, fontSize: 10, fontWeight: 700, color: '#a5b4fc', background: 'rgba(99,102,241,0.15)',
    padding: '1px 7px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: 0.4,
  },
  hiddenFooter: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  hiddenChip: {
    display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11,
    color: 'rgba(255,255,255,0.5)', background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)', padding: '3px 8px', borderRadius: 999,
  },
  filterSummary: { fontSize: 12, color: 'rgba(255,255,255,0.45)', marginLeft: 'auto', whiteSpace: 'nowrap' },
  subHint: { fontSize: 12, color: 'rgba(255,255,255,0.35)', margin: '0 0 12px' },

  // ── Inbox cards ──
  inboxGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6 },
  row: {
    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8,
  },
  rowMain: { display: 'flex', alignItems: 'baseline', gap: 10 },
  rowDate: { fontSize: 12, color: 'rgba(255,255,255,0.4)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 },
  rowDesc: {
    fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.85)', flex: 1,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  rowAmount: { fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums', flexShrink: 0 },
  rowControls: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  bizChip: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3 },
  rowAccount: { fontSize: 11, color: 'rgba(255,255,255,0.35)', flex: 1 },
  categorySelect: {
    padding: '5px 8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: 6, color: '#fff', fontSize: 12, fontFamily: 'inherit', outline: 'none', cursor: 'pointer',
  },
  categoryInput: {
    padding: '5px 8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: 6, color: '#fff', fontSize: 12, fontFamily: 'inherit', outline: 'none', minWidth: 120,
  },
  ruleCheck: {
    display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'rgba(255,255,255,0.5)',
    cursor: 'pointer', userSelect: 'none',
  },
  confirmBtn: {
    padding: '5px 12px', background: '#6366f1', border: 'none', borderRadius: 6,
    color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  },

  newRuleRow: { display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  deleteBtn: {
    background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', fontSize: 13,
    cursor: 'pointer', fontFamily: 'inherit', padding: '2px 6px',
  },

  // ── CSV import ──
  importPickBtn: {
    padding: '5px 11px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6, color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
  },
  importPanel: {
    position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 20, width: 520, maxWidth: '80vw',
    background: '#16162a', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10,
    padding: 14, boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
    display: 'flex', flexDirection: 'column', gap: 10,
  },
  importMeta: { display: 'flex', alignItems: 'baseline', gap: 10 },
  importFileName: { fontSize: 13, fontWeight: 600, color: '#fff', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  importCount: { fontSize: 12, color: 'rgba(255,255,255,0.5)', whiteSpace: 'nowrap' },
  importWarn: { fontSize: 12, color: '#fbbf24', whiteSpace: 'nowrap' },
  importControls: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  importResult: {
    padding: '8px 12px', background: 'rgba(34,197,94,0.1)',
    border: '1px solid rgba(34,197,94,0.3)', borderRadius: 6, color: '#4ade80', fontSize: 12,
  },
  importResultError: {
    padding: '8px 12px', background: 'rgba(239,68,68,0.1)',
    border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, color: '#fca5a5', fontSize: 12,
  },
};
