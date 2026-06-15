import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../contexts/ConfirmContext';
import useVisibilityRefresh from '../hooks/useVisibilityRefresh';
import {
  RESEARCH_FN_URL as FN_URL,
  RESEARCH_FIELDS as FIELDS,
  RESEARCH_CLEARED_TOKENS as CLEARED_TOKENS,
  emptyResearchForm,
} from '../lib/researchDocs';
import { checkHealth } from '../lib/tritonMcp';

const PRESET_QUERIES = [
  'Top 10 K/9 starters this season',
  'Highest avg exit velocity hitters 2024',
  'Best whiff rate pitches 2024',
  'Team ERA leaders 2024',
  'Fastest average fastball velocity starters 2024',
];

/* ─── helper: extract summary + table from MCP content blocks ─── */
function parseMcpResult(result) {
  let summary = '';
  let columns = [];
  let rows = [];

  const content = result?.content || [];
  for (const block of content) {
    if (block.type === 'text') {
      // Check if the text looks like a markdown table
      const lines = (block.text || '').trim().split('\n');
      const pipeLines = lines.filter(l => l.includes('|'));
      if (pipeLines.length > 2 && lines[1] && /^[\s|:-]+$/.test(lines[1])) {
        // Parse markdown table
        const headerLine = pipeLines[0];
        columns = headerLine.split('|').map(c => c.trim()).filter(Boolean);
        for (let i = 2; i < lines.length; i++) {
          if (!lines[i].includes('|')) continue;
          const cells = lines[i].split('|').map(c => c.trim()).filter(Boolean);
          if (cells.length > 0) rows.push(cells);
        }
      } else {
        summary += (summary ? '\n\n' : '') + block.text;
      }
    }
  }

  // If we got rows from a JSON-style result_data instead
  if (rows.length === 0 && result?.result_data) {
    const rd = result.result_data;
    if (Array.isArray(rd) && rd.length > 0) {
      columns = Object.keys(rd[0]);
      rows = rd.map(r => columns.map(c => r[c]));
    }
  }

  return { summary, columns, rows };
}

export default function ResearchDocs() {
  const { profile } = useAuth();
  const confirm = useConfirm();

  // Tab state
  const [section, setSection] = useState('documents');

  // ─── Documents state ───
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyResearchForm);
  const [busy, setBusy] = useState(false);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');

  // ─── Stats state ───
  const [mcpHealthy, setMcpHealthy] = useState(null); // null=checking, true, false
  const [queryInput, setQueryInput] = useState('');
  const [queryLoading, setQueryLoading] = useState(false);
  const [thread, setThread] = useState([]); // { id, type: 'user'|'result'|'error'|'loading', text, summary, columns, rows }
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const threadEndRef = useRef(null);

  // ─── Documents logic (unchanged) ───
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
    setForm(emptyResearchForm());
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
      setForm(emptyResearchForm());
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

  // ─── Stats: health check ───
  useEffect(() => {
    if (section !== 'stats') return;
    let cancelled = false;
    setMcpHealthy(null);
    checkHealth().then(ok => { if (!cancelled) setMcpHealthy(ok); });
    return () => { cancelled = true; };
  }, [section]);

  // ─── Stats: auto-scroll thread ───
  useEffect(() => {
    if (threadEndRef.current) {
      threadEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [thread]);

  // ─── Stats: fetch history ───
  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const { data, error: err } = await supabase
        .from('stats_queries')
        .select('id, query_text, summary, row_count, error_message, created_at, user_id, profiles(full_name)')
        .order('created_at', { ascending: false })
        .limit(50);
      if (err) throw err;
      setHistory(data || []);
    } catch (err) {
      console.error('Error fetching stats history:', err);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (section === 'stats' && showHistory) {
      fetchHistory();
    }
  }, [section, showHistory, fetchHistory]);

  // ─── Stats: submit query ───
  async function handleStatsQuery(text) {
    const trimmed = (text || '').trim();
    if (!trimmed || queryLoading) return;

    setQueryInput('');
    const entryId = Date.now();

    // Add user bubble + loading placeholder
    setThread(prev => [
      ...prev,
      { id: entryId, type: 'user', text: trimmed },
      { id: entryId + 1, type: 'loading', text: 'Querying database...' },
    ]);

    setQueryLoading(true);
    try {
      // Call stats-query edge function: NL → Claude SQL → Triton MCP
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('Not authenticated');

      const fnUrl = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/stats-query`;
      const res = await fetch(fnUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ question: trimmed }),
      });

      const resData = await res.json().catch(() => ({}));
      if (!res.ok || resData.ok === false) {
        throw new Error(resData.error || `Stats query failed (${res.status})`);
      }

      const { sql, result } = resData;
      const { summary, columns, rows } = parseMcpResult(result);

      // Replace loading with result
      setThread(prev => prev.map(e =>
        e.id === entryId + 1
          ? { ...e, type: 'result', text: summary || 'Query completed.', summary: summary || '', columns, rows, sql }
          : e
      ));

      // Persist to DB (fire-and-forget)
      if (profile?.id) {
        supabase.from('stats_queries').insert({
          user_id: profile.id,
          query_text: trimmed,
          tool_name: 'query_database',
          tool_args: { sql },
          summary: summary || null,
          result_data: rows.length > 0 ? rows.map(r => {
            const obj = {};
            columns.forEach((c, i) => { obj[c] = r[i] ?? null; });
            return obj;
          }) : null,
          row_count: rows.length,
        }).then(() => { if (showHistory) fetchHistory(); });
      }
    } catch (err) {
      setThread(prev => prev.map(e =>
        e.id === entryId + 1
          ? { ...e, type: 'error', text: err.message || 'Query failed' }
          : e
      ));

      // Persist error to DB
      if (profile?.id) {
        supabase.from('stats_queries').insert({
          user_id: profile.id,
          query_text: trimmed,
          tool_name: 'query_database',
          tool_args: { question: trimmed },
          error_message: err.message || 'Query failed',
        }).then(() => { if (showHistory) fetchHistory(); });
      }
    } finally {
      setQueryLoading(false);
    }
  }

  function handleHistoryClick(item) {
    setQueryInput(item.query_text);
    setShowHistory(false);
  }

  // ─── Render ───
  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.topBar}>
        <h1 style={styles.pageTitle}>Research</h1>
        {section === 'documents' && (
          <button onClick={openCreate} style={styles.addBtn}>
            + New Research Document
          </button>
        )}
      </div>

      {/* Tabs */}
      <div style={styles.sectionTabs}>
        {[['documents', 'Documents'], ['stats', 'Stats']].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setSection(key)}
            style={{ ...styles.sectionTab, ...(section === key ? styles.sectionTabActive : {}) }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ═══ Documents Tab ═══ */}
      {section === 'documents' && (
        <>
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
            <p style={styles.emptyText}>Loading...</p>
          ) : items.length === 0 ? (
            <div style={styles.emptyCard}>
              <p style={styles.emptyText}>No research documents yet. Click "+ New Research Document" to create one.</p>
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
        </>
      )}

      {/* ═══ Stats Tab ═══ */}
      {section === 'stats' && (
        <div style={styles.statsContainer}>
          {/* Status row */}
          <div style={styles.statusRow}>
            <div style={styles.statusLeft}>
              <span style={{
                ...styles.healthDot,
                background: mcpHealthy === null ? '#eab308' : mcpHealthy ? '#22c55e' : '#ef4444',
              }} />
              <span style={styles.statusLabel}>
                {mcpHealthy === null ? 'Checking connection...' : mcpHealthy ? 'Connected to Triton Stats' : 'Triton Stats unavailable'}
              </span>
            </div>
            <button
              onClick={() => setShowHistory(!showHistory)}
              style={{ ...styles.historyToggle, ...(showHistory ? styles.historyToggleActive : {}) }}
            >
              {showHistory ? 'Back to Query' : 'Query History'}
            </button>
          </div>

          {showHistory ? (
            /* ── History panel ── */
            <div style={styles.historyPanel}>
              {historyLoading ? (
                <p style={styles.emptyText}>Loading history...</p>
              ) : history.length === 0 ? (
                <div style={styles.emptyCard}>
                  <p style={styles.emptyText}>No queries yet.</p>
                </div>
              ) : (
                <div style={styles.list}>
                  {history.map(h => (
                    <div
                      key={h.id}
                      style={styles.historyRow}
                      onClick={() => handleHistoryClick(h)}
                    >
                      <div style={styles.historyRowMain}>
                        <span style={styles.historyQuery}>{h.query_text}</span>
                        <span style={styles.historyMeta}>
                          {h.profiles?.full_name || 'Unknown'}
                          {' \u00B7 '}
                          {new Date(h.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                          {h.row_count != null && ` \u00B7 ${h.row_count} rows`}
                          {h.error_message && ' \u00B7 Error'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* ── Query interface ── */
            <>
              {/* Preset chips */}
              <div style={styles.presetRow}>
                {PRESET_QUERIES.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => handleStatsQuery(q)}
                    disabled={queryLoading || mcpHealthy === false}
                    style={styles.presetChip}
                  >
                    {q}
                  </button>
                ))}
              </div>

              {/* Input bar */}
              <div style={styles.inputBar}>
                <input
                  value={queryInput}
                  onChange={(e) => setQueryInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleStatsQuery(queryInput); }}
                  placeholder="Ask about baseball stats..."
                  disabled={queryLoading || mcpHealthy === false}
                  style={styles.statsInput}
                />
                <button
                  onClick={() => handleStatsQuery(queryInput)}
                  disabled={queryLoading || !queryInput.trim() || mcpHealthy === false}
                  style={styles.askBtn}
                >
                  {queryLoading ? 'Querying...' : 'Ask'}
                </button>
              </div>

              {/* Conversational thread */}
              <div style={styles.threadContainer}>
                {thread.length === 0 && (
                  <div style={styles.emptyCard}>
                    <p style={styles.emptyText}>
                      Ask a question about baseball stats, or click a preset above.
                    </p>
                  </div>
                )}
                {thread.map(entry => {
                  if (entry.type === 'user') {
                    return (
                      <div key={entry.id} style={styles.userBubbleRow}>
                        <div style={styles.userBubble}>{entry.text}</div>
                      </div>
                    );
                  }
                  if (entry.type === 'loading') {
                    return (
                      <div key={entry.id} style={styles.loadingCard}>
                        <span style={styles.loadingDot} />
                        <span style={styles.loadingText}>{entry.text}</span>
                      </div>
                    );
                  }
                  if (entry.type === 'error') {
                    return (
                      <div key={entry.id} style={styles.errorCard}>
                        <p style={styles.errorText}>{entry.text}</p>
                      </div>
                    );
                  }
                  // result
                  return (
                    <div key={entry.id} style={styles.resultCard}>
                      {entry.summary && (
                        <div style={styles.summaryBlock}>
                          {entry.summary.split('\n').map((line, i) => (
                            <p key={i} style={styles.summaryLine}>{line}</p>
                          ))}
                        </div>
                      )}
                      {entry.columns && entry.columns.length > 0 && (
                        <div style={styles.tableWrap}>
                          <table style={styles.table}>
                            <thead>
                              <tr>
                                {entry.columns.map((col, ci) => (
                                  <th key={ci} style={styles.th}>{col}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {entry.rows.map((row, ri) => (
                                <tr key={ri} style={ri % 2 === 1 ? styles.trAlt : undefined}>
                                  {row.map((cell, ci) => (
                                    <td key={ci} style={styles.td}>{cell}</td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {(!entry.summary && (!entry.columns || entry.columns.length === 0)) && (
                        <p style={styles.emptyText}>No data returned.</p>
                      )}
                    </div>
                  );
                })}
                <div ref={threadEndRef} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const styles = {
  page: { padding: '32px 40px', minHeight: '100vh' },
  topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', gap: '16px' },
  pageTitle: { fontSize: '28px', fontWeight: 700, color: '#ffffff', margin: 0, letterSpacing: '-0.5px' },
  addBtn: { padding: '10px 20px', background: 'linear-gradient(135deg, #6366f1, #818cf8)', border: 'none', borderRadius: '10px', color: '#fff', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' },

  // Tabs (matches Research.js pattern)
  sectionTabs: { display: 'flex', gap: '4px', marginBottom: '20px', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: 0 },
  sectionTab: { padding: '10px 20px', border: 'none', borderBottom: '2px solid transparent', background: 'transparent', color: 'rgba(255,255,255,0.5)', fontSize: '14px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s' },
  sectionTabActive: { color: '#a5b4fc', borderBottomColor: '#6366f1' },

  // Document tab styles
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
  errorCard: { background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '12px', padding: '14px 18px', marginBottom: '12px' },
  errorText: { color: '#fca5a5', fontSize: '13px', margin: 0 },

  // ─── Stats tab styles ───
  statsContainer: { display: 'flex', flexDirection: 'column', gap: '16px' },

  // Status row
  statusRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  statusLeft: { display: 'flex', alignItems: 'center', gap: '8px' },
  healthDot: { width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0 },
  statusLabel: { fontSize: '13px', color: 'rgba(255,255,255,0.5)', fontWeight: 500 },
  historyToggle: { padding: '6px 14px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: 'rgba(255,255,255,0.6)', fontSize: '13px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' },
  historyToggleActive: { background: 'rgba(99,102,241,0.15)', borderColor: 'rgba(99,102,241,0.4)', color: '#a5b4fc' },

  // Presets
  presetRow: { display: 'flex', flexWrap: 'wrap', gap: '8px' },
  presetChip: { padding: '7px 14px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '20px', color: 'rgba(255,255,255,0.6)', fontSize: '12px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s', whiteSpace: 'nowrap' },

  // Input bar
  inputBar: { display: 'flex', gap: '8px' },
  statsInput: { flex: 1, padding: '12px 16px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: '#fff', fontSize: '14px', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' },
  askBtn: { padding: '12px 24px', background: '#6366f1', border: 'none', borderRadius: '10px', color: '#fff', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' },

  // Thread
  threadContainer: { display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '60vh', overflowY: 'auto', paddingRight: '4px' },

  // User bubble (right-aligned)
  userBubbleRow: { display: 'flex', justifyContent: 'flex-end' },
  userBubble: { maxWidth: '75%', padding: '10px 16px', background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: '14px 14px 4px 14px', color: '#c7d2fe', fontSize: '14px', lineHeight: 1.5 },

  // Loading
  loadingCard: { display: 'flex', alignItems: 'center', gap: '10px', padding: '16px 18px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px' },
  loadingDot: { width: '8px', height: '8px', borderRadius: '50%', background: '#6366f1', animation: 'pulse 1.2s ease-in-out infinite' },
  loadingText: { color: 'rgba(255,255,255,0.4)', fontSize: '13px', fontStyle: 'italic' },

  // Result card
  resultCard: { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px' },
  summaryBlock: { display: 'flex', flexDirection: 'column', gap: '6px' },
  summaryLine: { color: 'rgba(255,255,255,0.8)', fontSize: '14px', lineHeight: 1.6, margin: 0 },

  // Data table
  tableWrap: { overflowX: 'auto', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '13px', fontFamily: 'inherit' },
  th: { padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#a5b4fc', background: 'rgba(99,102,241,0.08)', borderBottom: '1px solid rgba(255,255,255,0.08)', whiteSpace: 'nowrap', position: 'sticky', top: 0 },
  td: { padding: '7px 12px', color: 'rgba(255,255,255,0.7)', borderBottom: '1px solid rgba(255,255,255,0.04)', whiteSpace: 'nowrap' },
  trAlt: { background: 'rgba(255,255,255,0.015)' },

  // History
  historyPanel: { marginTop: '4px' },
  historyRow: { display: 'flex', alignItems: 'center', gap: '14px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '12px 18px', cursor: 'pointer', transition: 'border-color 0.15s' },
  historyRowMain: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' },
  historyQuery: { fontSize: '14px', fontWeight: 500, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  historyMeta: { fontSize: '12px', color: 'rgba(255,255,255,0.35)' },
};
