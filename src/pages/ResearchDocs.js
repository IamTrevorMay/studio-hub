import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../contexts/ConfirmContext';
import useVisibilityRefresh from '../hooks/useVisibilityRefresh';

const FN_URL = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/google-drive-research`;

// Fields collected in the create modal. `key` matches the {{token}} in the
// template doc. The Big Question doubles as the document's name in Drive.
const FIELDS = [
  {
    key: 'big_question',
    label: 'Big Question / Working Title',
    help: 'The central question we are seeking to answer. Often this is the title, or directly maps to it. Everything in the research serves this.',
    multiline: false,
    required: true,
  },
  {
    key: 'scope',
    label: 'Scope',
    help: "The boundaries of the research: time period, specific players/teams, stat categories, era, etc. What's in bounds and what's out of bounds.",
    multiline: true,
  },
  {
    key: 'key_sources',
    label: 'Key Sources / Where to Look',
    help: "Direction on where to dig (Statcast, MLB Stats API, specific outlets, historical records, etc.) so researchers don't waste time hunting.",
    multiline: true,
  },
  {
    key: 'expected_output',
    label: 'Expected Output / Format',
    help: 'What "done" looks like: annotated notes, a structured doc with sections, key takeaways, supporting data/links. Be explicit so the handoff to the video team is smooth.',
    multiline: true,
  },
];

// Template tokens not collected in the modal (filled in by the researcher
// directly in the doc). We still clear them on create so no raw {{token}}
// text is left behind in the document.
const CLEARED_TOKENS = ['anomalies', 'sources'];

const emptyForm = () => FIELDS.reduce((acc, f) => { acc[f.key] = ''; return acc; }, {});

export default function ResearchDocs() {
  const { profile } = useAuth();
  const confirm = useConfirm();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);

  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');

  const callFn = useCallback(async (method, body) => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) throw new Error('Not authenticated');
    const res = await fetch(FN_URL, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }, []);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await callFn('GET');
      setItems(data.items || []);
    } catch (err) {
      console.error('Error fetching research docs:', err);
      setError(err.message);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [callFn]);

  useEffect(() => {
    if (!profile?.id) return;
    fetchItems();
  }, [profile?.id, fetchItems]);

  useVisibilityRefresh(() => fetchItems());

  function openCreate() {
    setForm(emptyForm());
    setShowCreate(true);
  }

  async function handleCreate(e) {
    e.preventDefault();
    const name = form.big_question.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const fields = FIELDS.reduce((acc, f) => { acc[f.key] = form[f.key].trim(); return acc; }, {});
      CLEARED_TOKENS.forEach((k) => { fields[k] = ''; });
      const result = await callFn('POST', {
        action: 'create-from-template',
        name,
        fields,
      });
      setShowCreate(false);
      setForm(emptyForm());
      fetchItems();
      if (result.url) window.open(result.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      alert('Failed to create document: ' + err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRename(id, name) {
    if (!name.trim()) { setRenamingId(null); return; }
    try {
      await callFn('POST', { action: 'rename', id, name: name.trim() });
      setRenamingId(null);
      setRenameValue('');
      fetchItems();
    } catch (err) {
      alert('Failed to rename: ' + err.message);
    }
  }

  async function handleDelete(item) {
    if (!(await confirm(`Move "${item.name}" to Drive trash?`))) return;
    try {
      await callFn('POST', { action: 'delete', id: item.id });
      fetchItems();
    } catch (err) {
      alert('Failed to delete: ' + err.message);
    }
  }

  function openDoc(item) {
    if (renamingId === item.id) return;
    if (item.url) window.open(item.url, '_blank', 'noopener,noreferrer');
  }

  return (
    <div style={styles.page}>
      <div style={styles.topBar}>
        <h1 style={styles.pageTitle}>Research</h1>
        <button onClick={openCreate} style={styles.addBtn}>
          + New Research Document
        </button>
      </div>

      {showCreate && (
        <div
          style={styles.modalOverlay}
          onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) setShowCreate(false); }}
        >
          <form onSubmit={handleCreate} style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h2 style={styles.modalTitle}>New Research Document</h2>
              <button type="button" onClick={() => !busy && setShowCreate(false)} style={styles.modalClose}>✕</button>
            </div>
            <div style={styles.modalBody}>
              {FIELDS.map((f) => (
                <div key={f.key} style={styles.field}>
                  <label style={styles.fieldLabel}>{f.label}</label>
                  <p style={styles.fieldHelp}>{f.help}</p>
                  {f.multiline ? (
                    <textarea
                      value={form[f.key]}
                      onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                      rows={3}
                      style={{ ...styles.input, resize: 'vertical', minHeight: 64 }}
                    />
                  ) : (
                    <input
                      autoFocus
                      value={form[f.key]}
                      onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                      required={f.required}
                      style={styles.input}
                    />
                  )}
                </div>
              ))}
            </div>
            <div style={styles.modalFooter}>
              <button type="button" onClick={() => !busy && setShowCreate(false)} style={styles.cancelBtn}>Cancel</button>
              <button type="submit" disabled={busy || !form.big_question.trim()} style={styles.submitBtn}>
                {busy ? 'Creating...' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      )}

      {error && (
        <div style={styles.errorCard}>
          <p style={styles.errorText}>Error: {error}</p>
        </div>
      )}

      {loading ? (
        <p style={styles.emptyText}>Loading…</p>
      ) : items.length === 0 ? (
        <div style={styles.emptyCard}>
          <p style={styles.emptyText}>No research documents yet. Click “+ New Research Document” to create one.</p>
        </div>
      ) : (
        <div style={styles.list}>
          {items.map(item => {
            const isRenaming = renamingId === item.id;
            return (
              <div key={item.id} style={styles.row} onClick={() => openDoc(item)}>
                <span style={styles.rowIcon}>📝</span>
                <div style={styles.rowMain}>
                  {isRenaming ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRename(item.id, renameValue);
                        if (e.key === 'Escape') { setRenamingId(null); setRenameValue(''); }
                      }}
                      onBlur={() => handleRename(item.id, renameValue)}
                      onClick={(e) => e.stopPropagation()}
                      style={styles.renameInput}
                    />
                  ) : (
                    <span style={styles.rowTitle}>{item.name}</span>
                  )}
                </div>
                <span style={styles.rowMeta}>
                  {item.modifiedTime
                    ? `Updated ${new Date(item.modifiedTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                    : ''}
                </span>
                <div style={styles.rowActions} onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => { setRenamingId(item.id); setRenameValue(item.name); }}
                    style={styles.actionBtn}
                    title="Rename"
                  >✏️</button>
                  <button
                    onClick={() => handleDelete(item)}
                    style={styles.actionBtn}
                    title="Delete"
                  >🗑</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const styles = {
  page: { padding: '32px 40px', minHeight: '100vh' },
  topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', gap: '16px' },
  pageTitle: { fontSize: '28px', fontWeight: 700, color: '#ffffff', margin: 0, letterSpacing: '-0.5px' },
  addBtn: { padding: '10px 20px', background: 'linear-gradient(135deg, #6366f1, #818cf8)', border: 'none', borderRadius: '10px', color: '#fff', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' },
  input: { width: '100%', boxSizing: 'border-box', padding: '10px 14px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '14px', fontFamily: 'inherit', outline: 'none' },
  submitBtn: { padding: '10px 20px', background: '#6366f1', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' },
  cancelBtn: { padding: '10px 20px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#e2e8f0', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '24px' },
  modal: { background: '#15151f', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '16px', width: '640px', maxWidth: '100%', maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' },
  modalHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.07)' },
  modalTitle: { fontSize: '18px', fontWeight: 700, color: '#fff', margin: 0 },
  modalClose: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: '16px', cursor: 'pointer', padding: '4px 8px' },
  modalBody: { padding: '20px 24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '18px' },
  modalFooter: { display: 'flex', justifyContent: 'flex-end', gap: '10px', padding: '16px 24px', borderTop: '1px solid rgba(255,255,255,0.07)' },
  field: { display: 'flex', flexDirection: 'column', gap: '6px' },
  fieldLabel: { fontSize: '14px', fontWeight: 600, color: '#fff' },
  fieldHelp: { fontSize: '12px', fontStyle: 'italic', color: 'rgba(255,255,255,0.45)', margin: 0, lineHeight: 1.4 },
  list: { display: 'flex', flexDirection: 'column', gap: '8px' },
  row: { display: 'flex', alignItems: 'center', gap: '14px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '14px 18px', cursor: 'pointer' },
  rowIcon: { fontSize: '18px', flexShrink: 0 },
  rowMain: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: '15px', fontWeight: 600, color: '#ffffff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' },
  rowMeta: { fontSize: '12px', color: 'rgba(255,255,255,0.35)', flexShrink: 0, whiteSpace: 'nowrap' },
  rowActions: { display: 'flex', gap: '4px', flexShrink: 0 },
  actionBtn: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: '14px', padding: '4px 6px', borderRadius: '6px' },
  renameInput: { width: '100%', padding: '4px 8px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(99,102,241,0.5)', borderRadius: '6px', color: '#fff', fontSize: '15px', fontWeight: 600, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' },
  emptyCard: { background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '14px', padding: '40px', textAlign: 'center' },
  emptyText: { color: 'rgba(255,255,255,0.35)', fontSize: '14px', margin: 0 },
  errorCard: { background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '12px', padding: '14px 18px', marginBottom: '20px' },
  errorText: { color: '#fca5a5', fontSize: '13px', margin: 0 },
};
