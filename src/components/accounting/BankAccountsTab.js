// Accounts tab for the Accounting page. Connect banks via Plaid Link,
// assign each account to a business, watch connection health, see latest
// balances. The visibility layer Tiller never provided.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { openPlaidLink } from '../../lib/plaidLink';
import { colors } from '../../lib/styleTokens';

const BUSINESSES = {
  mayday_media:        { label: 'Mayday Media',        color: '#5b8fc7' },
  neptune_performance: { label: 'Neptune Performance', color: '#06b6d4' },
};

const STATUS_META = {
  ok:              { label: 'Connected',      color: '#22c55e' },
  error:           { label: 'Error',          color: '#f97316' },
  relink_required: { label: 'Relink needed',  color: '#ef4444' },
};

function fmtMoney(cents) {
  if (cents == null) return '—';
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function fmtRelative(d) {
  if (!d) return 'Never';
  const mins = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function BankAccountsTab({ onSynced }) {
  const [items, setItems] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [balances, setBalances] = useState({});   // linked_account_id -> latest snapshot
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);         // 'connect' | 'sync' | itemId being relinked
  const [error, setError] = useState(null);
  // Post-Link business assignment: { publicToken, institution, accounts: [...] }
  const [assigning, setAssigning] = useState(null);

  const load = useCallback(async () => {
    const [itemsRes, acctsRes, balRes] = await Promise.all([
      supabase.from('plaid_items_health').select('*').order('created_at'),
      supabase.from('linked_accounts').select('*').order('created_at'),
      supabase.from('account_balances').select('linked_account_id, balance_cents, available_cents, snapshot_date')
        .order('snapshot_date', { ascending: false }).limit(200),
    ]);
    setItems(itemsRes.data || []);
    setAccounts(acctsRes.data || []);
    const latest = {};
    for (const b of balRes.data || []) {
      if (!latest[b.linked_account_id]) latest[b.linked_account_id] = b;
    }
    setBalances(latest);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const accountsByItem = useMemo(() => {
    const map = {};
    for (const a of accounts) (map[a.item_id] ||= []).push(a);
    return map;
  }, [accounts]);

  async function startConnect() {
    setBusy('connect');
    setError(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('plaid-link-token', { body: {} });
      if (fnErr) throw fnErr;
      await openPlaidLink({
        token: data.link_token,
        onSuccess: (publicToken, metadata) => {
          setAssigning({
            publicToken,
            institution: metadata.institution || {},
            accounts: (metadata.accounts || []).map(a => ({
              ...a, business: 'mayday_media',
            })),
          });
          setBusy(null);
        },
        onExit: () => setBusy(null),
      });
    } catch (err) {
      setError(err?.message || 'Failed to start Plaid Link');
      setBusy(null);
    }
  }

  async function finishConnect() {
    setBusy('connect');
    setError(null);
    try {
      const businessByAccount = {};
      for (const a of assigning.accounts) businessByAccount[a.id] = a.business;
      const { error: fnErr } = await supabase.functions.invoke('plaid-exchange-token', {
        body: {
          public_token: assigning.publicToken,
          institution: { id: assigning.institution.institution_id, name: assigning.institution.name },
          businessByAccount,
        },
      });
      if (fnErr) throw fnErr;
      setAssigning(null);
      await load();
      await syncNow();
    } catch (err) {
      setError(err?.message || 'Failed to link bank');
    } finally {
      setBusy(null);
    }
  }

  async function relink(itemId) {
    setBusy(itemId);
    setError(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('plaid-link-token', { body: { itemId } });
      if (fnErr) throw fnErr;
      await openPlaidLink({
        token: data.link_token,
        onSuccess: async () => { await syncNow(); setBusy(null); },
        onExit: () => setBusy(null),
      });
    } catch (err) {
      setError(err?.message || 'Failed to start relink');
      setBusy(null);
    }
  }

  const syncNow = useCallback(async () => {
    setBusy('sync');
    setError(null);
    try {
      const { error: fnErr } = await supabase.functions.invoke('plaid-sync', { body: {} });
      if (fnErr) throw fnErr;
      await load();
      if (onSynced) onSynced();
    } catch (err) {
      setError(err?.message || 'Sync failed');
    } finally {
      setBusy(null);
    }
  }, [load, onSynced]);

  async function updateAccount(id, patch) {
    setAccounts(prev => prev.map(a => (a.id === id ? { ...a, ...patch } : a)));
    const { error: upErr } = await supabase.from('linked_accounts').update(patch).eq('id', id);
    if (upErr) { setError(upErr.message); load(); }
  }

  if (loading) return <p style={styles.emptyText}>Loading accounts…</p>;

  return (
    <div>
      <div style={styles.actionRow}>
        <button onClick={startConnect} disabled={!!busy} style={styles.connectBtn}>
          + Connect bank
        </button>
        <button onClick={syncNow} disabled={!!busy} style={styles.syncBtn}>
          {busy === 'sync' ? 'Syncing…' : 'Sync now'}
        </button>
      </div>

      {error && <div style={styles.errorBanner}>{error}</div>}

      {items.length === 0 ? (
        <p style={styles.emptyText}>
          No banks connected yet. Connect your first account to start pulling transactions directly.
        </p>
      ) : items.map(item => {
        const status = STATUS_META[item.status] || STATUS_META.error;
        const itemAccounts = accountsByItem[item.id] || [];
        return (
          <div key={item.id} style={styles.itemCard}>
            <div style={styles.itemHeader}>
              <span style={styles.itemName}>{item.institution_name || 'Bank'}</span>
              <span style={{ ...styles.statusChip, color: status.color, borderColor: status.color }}>
                {status.label}
              </span>
              <span style={styles.itemMeta}>Last sync: {fmtRelative(item.last_synced_at)}</span>
              {item.status !== 'ok' && (
                <button onClick={() => relink(item.id)} disabled={!!busy} style={styles.relinkBtn}>
                  {busy === item.id ? 'Opening…' : 'Reconnect'}
                </button>
              )}
            </div>
            {item.error_code && item.status !== 'ok' && (
              <div style={styles.errorCode}>{item.error_code}</div>
            )}
            <div style={styles.accountList}>
              {itemAccounts.map(a => {
                const bal = balances[a.id];
                return (
                  <div key={a.id} style={{ ...styles.accountRow, opacity: a.is_active ? 1 : 0.45 }}>
                    <div style={styles.accountInfo}>
                      <span style={styles.accountName}>
                        {a.name || 'Account'}{a.mask ? ` ··${a.mask}` : ''}
                      </span>
                      <span style={styles.accountType}>{a.account_subtype || a.account_type || ''}</span>
                    </div>
                    <span style={styles.accountBalance}>{fmtMoney(bal?.balance_cents)}</span>
                    <select
                      value={a.business}
                      onChange={e => updateAccount(a.id, { business: e.target.value })}
                      style={{ ...styles.bizSelect, borderColor: BUSINESSES[a.business]?.color }}
                    >
                      {Object.entries(BUSINESSES).map(([k, b]) => (
                        <option key={k} value={k}>{b.label}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => updateAccount(a.id, { is_active: !a.is_active })}
                      style={styles.toggleBtn}
                      title={a.is_active ? 'Stop syncing this account' : 'Resume syncing this account'}
                    >
                      {a.is_active ? 'Active' : 'Paused'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Post-Link business assignment modal */}
      {assigning && (
        <div style={styles.modalBackdrop}>
          <div style={styles.modal}>
            <h3 style={styles.modalTitle}>
              Assign accounts — {assigning.institution?.name || 'Bank'}
            </h3>
            <p style={styles.modalSub}>Which business does each account belong to?</p>
            {assigning.accounts.map((a, i) => (
              <div key={a.id} style={styles.assignRow}>
                <span style={styles.accountName}>
                  {a.name}{a.mask ? ` ··${a.mask}` : ''}
                </span>
                <select
                  value={a.business}
                  onChange={e => setAssigning(prev => {
                    const next = { ...prev, accounts: [...prev.accounts] };
                    next.accounts[i] = { ...next.accounts[i], business: e.target.value };
                    return next;
                  })}
                  style={styles.bizSelect}
                >
                  {Object.entries(BUSINESSES).map(([k, b]) => (
                    <option key={k} value={k}>{b.label}</option>
                  ))}
                </select>
              </div>
            ))}
            <div style={styles.modalActions}>
              <button onClick={() => setAssigning(null)} style={styles.cancelBtn}>Cancel</button>
              <button onClick={finishConnect} disabled={busy === 'connect'} style={styles.connectBtn}>
                {busy === 'connect' ? 'Linking…' : 'Finish linking'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  actionRow: { display: 'flex', gap: 10, marginBottom: 16 },
  connectBtn: {
    padding: '8px 16px', background: colors.accent, border: 'none', borderRadius: 8,
    color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  },
  syncBtn: {
    padding: '8px 16px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8, color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit',
  },
  errorBanner: {
    padding: '10px 14px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
    borderRadius: 8, color: '#fca5a5', fontSize: 13, marginBottom: 16,
  },
  emptyText: { color: 'rgba(255,255,255,0.4)', fontSize: 14, padding: '24px 0' },

  itemCard: {
    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 12, padding: 16, marginBottom: 14,
  },
  itemHeader: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  itemName: { fontSize: 15, fontWeight: 700, color: '#fff' },
  statusChip: {
    fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999,
    border: '1px solid', textTransform: 'uppercase', letterSpacing: 0.3,
  },
  itemMeta: { fontSize: 12, color: 'rgba(255,255,255,0.35)', marginLeft: 'auto' },
  relinkBtn: {
    padding: '5px 12px', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.35)',
    borderRadius: 6, color: '#fca5a5', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  },
  errorCode: { fontSize: 11, color: '#fca5a5', fontFamily: 'monospace', marginTop: 6 },
  accountList: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 },
  accountRow: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '8px 10px', background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.05)', borderRadius: 8,
  },
  accountInfo: { display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0 },
  accountName: { fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.85)' },
  accountType: { fontSize: 11, color: 'rgba(255,255,255,0.35)', textTransform: 'capitalize' },
  accountBalance: { fontSize: 13, fontWeight: 700, color: '#fff', fontVariantNumeric: 'tabular-nums' },
  bizSelect: {
    padding: '5px 8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: 6, color: '#fff', fontSize: 12, fontFamily: 'inherit', outline: 'none', cursor: 'pointer',
  },
  toggleBtn: {
    padding: '5px 10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6, color: 'rgba(255,255,255,0.6)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
  },

  modalBackdrop: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  modal: {
    background: colors.bgHover, border: '1px solid rgba(255,255,255,0.12)', borderRadius: 14,
    padding: 24, width: 440, maxWidth: '90vw', maxHeight: '80vh', overflowY: 'auto',
  },
  modalTitle: { margin: 0, fontSize: 16, fontWeight: 700, color: '#fff' },
  modalSub: { fontSize: 13, color: 'rgba(255,255,255,0.5)', margin: '6px 0 16px' },
  assignRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  modalActions: { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 },
  cancelBtn: {
    padding: '8px 16px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8, color: 'rgba(255,255,255,0.6)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
  },
};
