// Transactions tab for the Accounting page. Review inbox for AI-categorized
// Plaid transactions (confirm or fix; fixes can become rules) plus the
// merchant-rule manager. Transactions already count in reports before review —
// this tab is for corrections, not gatekeeping.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../contexts/AuthContext';

const BUSINESSES = {
  mayday_media:        { label: 'Mayday', color: '#6366f1' },
  neptune_performance: { label: 'Neptune', color: '#06b6d4' },
};

const TRANSFER_CATEGORY = 'Transfer';

function fmtMoney(cents) {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export default function TransactionsTab({ revenueMeta, expenseMeta, onChanged }) {
  const { profile } = useAuth();
  const [inbox, setInbox] = useState([]);       // { table, kind, ...row }
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [makeRule, setMakeRule] = useState({}); // row id -> bool (default true when category edited)
  const [drafts, setDrafts] = useState({});     // row id -> draft category
  const [newRule, setNewRule] = useState({ pattern: '', match_type: 'contains', txn_kind: 'expense', category: '', business: '' });

  const load = useCallback(async () => {
    const [revRes, expRes, rulesRes] = await Promise.all([
      supabase.from('revenue_transactions')
        .select('id, date, description, category, amount_cents, account, business, is_transfer')
        .eq('review_status', 'auto').order('date', { ascending: false }).limit(200),
      supabase.from('expense_transactions')
        .select('id, date, description, category, amount_cents, account, business, is_transfer')
        .eq('review_status', 'auto').order('date', { ascending: false }).limit(200),
      supabase.from('category_rules').select('*').order('created_at', { ascending: false }),
    ]);
    const rows = [
      ...(revRes.data || []).map(r => ({ ...r, table: 'revenue_transactions', kind: 'revenue' })),
      ...(expRes.data || []).map(r => ({ ...r, table: 'expense_transactions', kind: 'expense' })),
    ].sort((a, b) => (a.date < b.date ? 1 : -1));
    setInbox(rows);
    setRules(rulesRes.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Neptune category suggestions come from whatever already exists
  const neptuneCategories = useMemo(() => {
    const cats = new Set();
    for (const r of inbox) if (r.business === 'neptune_performance') cats.add(r.category);
    return [...cats].sort();
  }, [inbox]);

  function categoryOptions(row) {
    if (row.business !== 'mayday_media') return null; // freeform for Neptune
    const meta = row.kind === 'revenue' ? revenueMeta : expenseMeta;
    return [...Object.keys(meta), TRANSFER_CATEGORY, 'Uncategorized'];
  }

  async function confirm(row) {
    setError(null);
    const draft = drafts[row.id];
    const finalCategory = draft ?? row.category;
    const changed = finalCategory !== row.category;
    const isTransfer = finalCategory === TRANSFER_CATEGORY;

    const { error: upErr } = await supabase.from(row.table).update({
      category: finalCategory,
      review_status: 'confirmed',
      is_transfer: isTransfer,
      ...(changed ? { categorized_by: 'manual' } : {}),
    }).eq('id', row.id);
    if (upErr) { setError(upErr.message); return; }

    // A correction becomes a rule unless the checkbox was unticked
    if (changed && !isTransfer && (makeRule[row.id] ?? true)) {
      await supabase.from('category_rules').insert({
        pattern: row.description,
        match_type: 'exact',
        txn_kind: row.kind,
        category: finalCategory,
        business: row.business,
        created_by: profile?.id || null,
      });
      const { data } = await supabase.from('category_rules').select('*').order('created_at', { ascending: false });
      setRules(data || []);
    }

    setInbox(prev => prev.filter(r => r.id !== row.id));
    if (onChanged) onChanged();
  }

  async function confirmAll() {
    setError(null);
    // Only untouched rows batch-confirm; edited rows go through confirm() so
    // their rule creation logic runs.
    const untouched = inbox.filter(r => drafts[r.id] == null);
    for (const table of ['revenue_transactions', 'expense_transactions']) {
      const ids = untouched.filter(r => r.table === table).map(r => r.id);
      if (ids.length === 0) continue;
      const { error: upErr } = await supabase.from(table)
        .update({ review_status: 'confirmed' }).in('id', ids);
      if (upErr) { setError(upErr.message); return; }
    }
    setInbox(prev => prev.filter(r => drafts[r.id] != null));
    if (onChanged) onChanged();
  }

  async function addRule() {
    setError(null);
    if (!newRule.pattern.trim() || !newRule.category.trim()) return;
    const { error: insErr } = await supabase.from('category_rules').insert({
      pattern: newRule.pattern.trim(),
      match_type: newRule.match_type,
      txn_kind: newRule.txn_kind,
      category: newRule.category.trim(),
      business: newRule.business || null,
      created_by: profile?.id || null,
    });
    if (insErr) { setError(insErr.message); return; }
    setNewRule({ pattern: '', match_type: 'contains', txn_kind: 'expense', category: '', business: '' });
    const { data } = await supabase.from('category_rules').select('*').order('created_at', { ascending: false });
    setRules(data || []);
  }

  async function deleteRule(id) {
    setRules(prev => prev.filter(r => r.id !== id));
    const { error: delErr } = await supabase.from('category_rules').delete().eq('id', id);
    if (delErr) { setError(delErr.message); load(); }
  }

  if (loading) return <p style={styles.emptyText}>Loading…</p>;

  return (
    <div>
      {error && <div style={styles.errorBanner}>{error}</div>}

      {/* ── Review inbox ── */}
      <div style={styles.sectionHeader}>
        <h2 style={styles.sectionTitle}>Review inbox</h2>
        <span style={styles.sectionCount}>{inbox.length}</span>
        {inbox.length > 0 && (
          <button onClick={confirmAll} style={styles.confirmAllBtn}>Confirm all unedited</button>
        )}
      </div>
      {inbox.length === 0 ? (
        <p style={styles.emptyText}>All caught up — nothing awaiting review.</p>
      ) : (
        <div style={styles.list}>
          {inbox.map(row => {
            const options = categoryOptions(row);
            const draft = drafts[row.id] ?? row.category;
            const edited = draft !== row.category;
            return (
              <div key={`${row.table}_${row.id}`} style={styles.row}>
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
                      onChange={e => setDrafts(prev => ({ ...prev, [row.id]: e.target.value }))}
                      style={styles.categorySelect}
                    >
                      {!options.includes(draft) && <option value={draft}>{draft}</option>}
                      {options.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  ) : (
                    <>
                      <input
                        value={draft}
                        onChange={e => setDrafts(prev => ({ ...prev, [row.id]: e.target.value }))}
                        list="neptune-categories"
                        style={styles.categoryInput}
                      />
                      <datalist id="neptune-categories">
                        {neptuneCategories.map(c => <option key={c} value={c} />)}
                      </datalist>
                    </>
                  )}
                  {edited && draft !== TRANSFER_CATEGORY && (
                    <label style={styles.ruleCheck}>
                      <input
                        type="checkbox"
                        checked={makeRule[row.id] ?? true}
                        onChange={e => setMakeRule(prev => ({ ...prev, [row.id]: e.target.checked }))}
                      />
                      rule
                    </label>
                  )}
                  <button onClick={() => confirm(row)} style={styles.confirmBtn}>
                    {edited ? 'Fix & confirm' : 'Confirm'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Rules ── */}
      <div style={{ ...styles.sectionHeader, marginTop: 32 }}>
        <h2 style={styles.sectionTitle}>Category rules</h2>
        <span style={styles.sectionCount}>{rules.length}</span>
      </div>
      <div style={styles.newRuleRow}>
        <input
          placeholder="Merchant pattern (e.g. ADOBE)"
          value={newRule.pattern}
          onChange={e => setNewRule(r => ({ ...r, pattern: e.target.value }))}
          style={{ ...styles.categoryInput, flex: 2 }}
        />
        <select value={newRule.match_type} onChange={e => setNewRule(r => ({ ...r, match_type: e.target.value }))} style={styles.categorySelect}>
          <option value="contains">contains</option>
          <option value="exact">exact</option>
        </select>
        <select value={newRule.txn_kind} onChange={e => setNewRule(r => ({ ...r, txn_kind: e.target.value }))} style={styles.categorySelect}>
          <option value="expense">expense</option>
          <option value="revenue">revenue</option>
        </select>
        <select value={newRule.business} onChange={e => setNewRule(r => ({ ...r, business: e.target.value }))} style={styles.categorySelect}>
          <option value="">any business</option>
          <option value="mayday_media">Mayday</option>
          <option value="neptune_performance">Neptune</option>
        </select>
        <input
          placeholder="Category"
          value={newRule.category}
          onChange={e => setNewRule(r => ({ ...r, category: e.target.value }))}
          style={{ ...styles.categoryInput, flex: 1 }}
        />
        <button onClick={addRule} style={styles.confirmBtn}>Add rule</button>
      </div>
      {rules.length === 0 ? (
        <p style={styles.emptyText}>No rules yet. Fixing a category in the inbox creates one automatically.</p>
      ) : (
        <div style={styles.list}>
          {rules.map(rule => (
            <div key={rule.id} style={styles.ruleRow}>
              <span style={styles.rulePattern}>{rule.pattern}</span>
              <span style={styles.ruleMeta}>{rule.match_type}</span>
              <span style={styles.ruleMeta}>{rule.txn_kind}</span>
              <span style={{ ...styles.ruleMeta, color: rule.business ? BUSINESSES[rule.business]?.color : undefined }}>
                {rule.business ? BUSINESSES[rule.business]?.label : 'any'}
              </span>
              <span style={styles.ruleArrow}>→</span>
              <span style={styles.ruleCategory}>{rule.category}</span>
              <button onClick={() => deleteRule(rule.id)} style={styles.deleteBtn} title="Delete rule">✕</button>
            </div>
          ))}
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

  sectionHeader: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 },
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

  list: { display: 'flex', flexDirection: 'column', gap: 6 },
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
  ruleRow: {
    display: 'flex', alignItems: 'center', gap: 10,
    background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)',
    borderRadius: 8, padding: '8px 12px',
  },
  rulePattern: { fontSize: 12, fontWeight: 600, color: '#fff', fontFamily: 'monospace', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' },
  ruleMeta: { fontSize: 11, color: 'rgba(255,255,255,0.4)' },
  ruleArrow: { fontSize: 12, color: 'rgba(255,255,255,0.3)' },
  ruleCategory: { fontSize: 12, fontWeight: 600, color: '#a5b4fc' },
  deleteBtn: {
    background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', fontSize: 13,
    cursor: 'pointer', fontFamily: 'inherit', padding: '2px 6px',
  },
};
