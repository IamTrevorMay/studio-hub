import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../contexts/ConfirmContext';
import useVisibilityRefresh from '../hooks/useVisibilityRefresh';
import { callEdgeFn } from '../lib/edgeFn';
import { queueTypeLabel, queueTypeColor } from '../lib/filmQueue';
import { colors } from '../lib/styleTokens';

function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

function fmtCreated(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function cueText(entry) {
  if (entry && typeof entry === 'object') return entry.title || entry.name || '';
  return String(entry ?? '');
}

// Call sheets live here: one row per generated sheet, click to open. Content
// is a frozen snapshot (call_sheets.items) taken at lock time, so later beat
// sheet edits don't rewrite a filmed session's paperwork.
export default function CallSheets() {
  const { isAdmin } = useAuth();
  const confirm = useConfirm();
  const [callSheets, setCallSheets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState(null);

  const fetchAll = useCallback(async () => {
    const { data, error } = await supabase
      .from('call_sheets')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) console.error('Error loading call sheets:', error);
    else setCallSheets(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useVisibilityRefresh(fetchAll);

  // Manual counterpart of the 6am job: locks the next unlocked session and
  // generates its call sheet + prompter session right now.
  async function generateNow() {
    if (generating) return;
    const ok = await confirm(
      'Lock the next session and generate its call sheet now? Items approved afterward roll to the following session.',
    );
    if (!ok) return;
    setGenerating(true);
    setNotice(null);
    try {
      const result = await callEdgeFn('film-queue', { action: 'lock_session', force: true });
      if (result.skipped) setNotice(result.skipped);
      else if (result.prompter_error) setNotice(`Call sheet generated, but the prompter push failed: ${result.prompter_error}`);
      else if (result.call_sheet) setNotice(`Call sheet generated — ${result.packed} slate${result.packed === 1 ? '' : 's'}, ${result.total_minutes} min.`);
      else setNotice('Session locked — nothing approved to pack.');
      await fetchAll();
    } catch (err) {
      setNotice(`Generate failed: ${err.message}`);
    }
    setGenerating(false);
  }

  const openSheet = openId ? callSheets.find((c) => c.id === openId) : null;

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div>
          <h1 style={styles.pageTitle}>Call Sheets</h1>
          <p style={styles.pageSubtitle}>
            Generated from each packed film session — slates, timings, and the beat sheets inline.
          </p>
        </div>
        {isAdmin && !openSheet && (
          <button
            onClick={generateNow}
            disabled={generating}
            style={{ ...styles.generateBtn, opacity: generating ? 0.5 : 1 }}
          >
            {generating ? 'Generating…' : 'Lock & Generate Now'}
          </button>
        )}
        {openSheet && (
          <button onClick={() => setOpenId(null)} style={styles.backBtn}>← All Call Sheets</button>
        )}
      </header>

      {notice && <p style={styles.notice}>{notice}</p>}

      {openSheet ? (
        <CallSheetDetail sheet={openSheet} />
      ) : loading ? (
        <p style={styles.emptyText}>Loading call sheets...</p>
      ) : callSheets.length === 0 ? (
        <p style={styles.emptyText}>
          No call sheets yet. One is generated automatically at 6am on each session day.
        </p>
      ) : (
        <div style={styles.list}>
          <div style={{ ...styles.rowGrid, ...styles.theadRow }}>
            <span style={styles.th}>Session</span>
            <span style={styles.th}>Slates</span>
            <span style={styles.th}>Beat Sheets</span>
            <span style={styles.th}>Created</span>
          </div>
          {callSheets.map((cs) => {
            const items = Array.isArray(cs.items) ? cs.items : [];
            return (
              <div key={cs.id} style={styles.row} onClick={() => setOpenId(cs.id)}>
                <span style={styles.sessionCell}>{fmtDate(cs.session_date)}</span>
                <span style={styles.slateCell}>{cs.slate_count}</span>
                <span style={styles.titlesCell}>
                  {items.map((i) => i.title).filter(Boolean).join(' · ') || '—'}
                </span>
                <span style={styles.createdCell}>{fmtCreated(cs.created_at)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CallSheetDetail({ sheet }) {
  const items = Array.isArray(sheet.items) ? sheet.items : [];
  const totalMinutes = items.reduce((s, i) => s + (Number(i.estimated_minutes) || 0), 0);

  return (
    <div style={styles.detail}>
      <div style={styles.detailHeader}>
        <div>
          <h2 style={styles.detailTitle}>{fmtDate(sheet.session_date)}</h2>
          <p style={styles.detailMeta}>Generated {fmtCreated(sheet.created_at)}</p>
        </div>
        <div style={styles.slateCount}>
          <span style={styles.slateCountValue}>{sheet.slate_count}</span>
          <span style={styles.slateCountLabel}>slate{sheet.slate_count === 1 ? '' : 's'} · {totalMinutes} min</span>
        </div>
      </div>

      {items.map((item, idx) => (
        <section key={item.queue_item_id || idx} style={styles.block}>
          <div style={styles.blockHeader}>
            <span style={styles.slateNum}>Slate {item.slate || idx + 1}</span>
            <span style={styles.blockTitle}>{item.title}</span>
            <span style={{ ...styles.typeChip, background: `${queueTypeColor(item.queue_type)}26`, color: queueTypeColor(item.queue_type), borderColor: `${queueTypeColor(item.queue_type)}55` }}>
              {queueTypeLabel(item.queue_type)}
            </span>
            <span style={styles.blockMinutes}>{item.estimated_minutes} min</span>
          </div>
          <BeatTable beats={item.beats || []} />
        </section>
      ))}
    </div>
  );
}

// Read-only render of the frozen beats, in the beat sheet format: segments as
// colored subheaders, one row per beat with graphics / videos / notes.
function BeatTable({ beats }) {
  const rows = [];
  for (const node of beats) {
    if (node?.type === 'segment') {
      rows.push({ kind: 'segment', node });
      for (const child of node.children || []) rows.push({ kind: 'beat', node: child });
    } else if (node) {
      rows.push({ kind: 'beat', node });
    }
  }
  const beatRows = rows.filter((r) => r.kind === 'beat' && (r.node.title || '').trim());
  if (beatRows.length === 0) {
    return <p style={styles.emptyText}>This beat sheet is empty.</p>;
  }

  return (
    <div style={styles.beatTable}>
      <div style={{ ...styles.beatGrid, ...styles.beatHead }}>
        <span style={styles.th}>Beat / Context</span>
        <span style={styles.th}>Graphics</span>
        <span style={styles.th}>Videos</span>
        <span style={styles.th}>Notes</span>
      </div>
      {rows.map((r, i) => {
        if (r.kind === 'segment') {
          if (!(r.node.title || '').trim()) return null;
          return (
            <div key={r.node.id || i} style={{ ...styles.segmentRow, borderLeft: `3px solid ${r.node.color || '#8fb4d8'}` }}>
              {r.node.title}
            </div>
          );
        }
        const b = r.node;
        if (!(b.title || '').trim()) return null;
        return (
          <div key={b.id || i} style={styles.beatGrid}>
            <div>
              <div style={styles.beatTitle}>{b.title}</div>
              {b.context && <div style={styles.beatContext}>{b.context}</div>}
            </div>
            <div style={styles.cueCell}>
              {(b.graphics || []).map((g, gi) => (
                <span key={gi} style={{ ...styles.cueChip, color: colors.gold, borderColor: colors.warning.border }}>{cueText(g)}</span>
              ))}
            </div>
            <div style={styles.cueCell}>
              {(b.videos || []).map((v, vi) => (
                <span key={vi} style={{ ...styles.cueChip, color: colors.info.fg, borderColor: colors.info.border }}>{cueText(v)}</span>
              ))}
            </div>
            <div style={styles.notesCell}>{b.notes || ''}</div>
          </div>
        );
      })}
    </div>
  );
}

const styles = {
  page: { padding: '36px 40px 64px', maxWidth: '1200px', margin: '0 auto', minHeight: '100vh' },
  header: {
    marginBottom: '24px',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '16px',
    flexWrap: 'wrap',
  },
  pageTitle: { fontSize: '28px', fontWeight: 700, color: colors.white, margin: '0 0 6px 0', letterSpacing: '-0.5px' },
  pageSubtitle: { fontSize: '13px', color: colors.whiteA45, margin: 0 },
  generateBtn: {
    padding: '8px 16px', background: colors.accent, border: 'none', borderRadius: '8px',
    color: colors.white, fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  },
  backBtn: {
    padding: '8px 16px', background: colors.whiteA06,
    border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px',
    color: colors.textMuted, fontSize: '13px', fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit',
  },
  notice: {
    fontSize: '13px', color: colors.textBright, background: colors.whiteA05,
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px',
    padding: '10px 14px', margin: '0 0 16px',
  },
  // ── list ──
  list: {
    background: colors.whiteA02,
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: '12px',
    padding: '14px 16px 16px',
  },
  rowGrid: {
    display: 'grid',
    gridTemplateColumns: '200px 60px minmax(240px, 1fr) 130px',
    gap: '12px',
    alignItems: 'center',
  },
  theadRow: { padding: '4px 10px 8px', borderBottom: '1px solid rgba(255,255,255,0.08)' },
  th: {
    fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
    color: colors.textDim,
  },
  row: {
    display: 'grid',
    gridTemplateColumns: '200px 60px minmax(240px, 1fr) 130px',
    gap: '12px',
    alignItems: 'center',
    padding: '12px 10px',
    borderBottom: '1px solid rgba(255,255,255,0.05)',
    borderRadius: '8px',
    cursor: 'pointer',
  },
  sessionCell: { fontSize: '13px', fontWeight: 600, color: colors.textBright },
  slateCell: { fontSize: '13px', fontWeight: 700, color: colors.textMuted },
  titlesCell: { fontSize: '12px', color: colors.textSubtle, wordBreak: 'break-word' },
  createdCell: { fontSize: '12px', color: colors.textDim, whiteSpace: 'nowrap' },
  emptyText: { color: colors.textDim, fontSize: '13px', margin: '8px 4px 4px 4px' },
  // ── detail ──
  detail: { display: 'flex', flexDirection: 'column', gap: '18px' },
  detailHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px',
    background: colors.accentA06, border: '1px solid rgba(91, 143, 199, 0.25)',
    borderRadius: '12px', padding: '16px 20px', flexWrap: 'wrap',
  },
  detailTitle: { fontSize: '20px', fontWeight: 700, color: colors.white, margin: 0 },
  detailMeta: { fontSize: '12px', color: colors.whiteA45, margin: '4px 0 0' },
  slateCount: { display: 'flex', alignItems: 'baseline', gap: '8px' },
  slateCountValue: { fontSize: '28px', fontWeight: 700, color: colors.accentFg },
  slateCountLabel: { fontSize: '12px', fontWeight: 600, color: colors.textSubtle },
  block: {
    background: colors.whiteA02,
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: '12px',
    padding: '14px 16px 16px',
  },
  blockHeader: {
    display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px', flexWrap: 'wrap',
  },
  slateNum: {
    fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
    color: colors.accentFg, background: colors.accentA12, padding: '3px 10px', borderRadius: '10px',
  },
  blockTitle: { fontSize: '15px', fontWeight: 700, color: colors.textBright },
  typeChip: {
    display: 'inline-block', padding: '2px 8px', borderRadius: '10px', border: '1px solid',
    fontSize: '11px', fontWeight: 600, whiteSpace: 'nowrap',
  },
  blockMinutes: { fontSize: '12px', fontWeight: 600, color: colors.textSubtle, marginLeft: 'auto' },
  // ── beat table ──
  beatTable: { display: 'flex', flexDirection: 'column' },
  beatGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(220px, 2fr) minmax(120px, 1fr) minmax(120px, 1fr) minmax(140px, 1fr)',
    gap: '12px',
    padding: '10px',
    borderBottom: '1px solid rgba(255,255,255,0.05)',
    alignItems: 'start',
  },
  beatHead: { padding: '4px 10px 8px', borderBottom: '1px solid rgba(255,255,255,0.08)' },
  segmentRow: {
    padding: '8px 10px',
    margin: '6px 0 0',
    fontSize: '12px',
    fontWeight: 700,
    color: colors.textBright,
    background: colors.bgInput,
    borderRadius: '6px',
  },
  beatTitle: { fontSize: '13px', color: colors.textBright, whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  beatContext: {
    fontSize: '12px', color: colors.textSubtle, whiteSpace: 'pre-wrap',
    wordBreak: 'break-word', marginTop: '4px',
  },
  cueCell: { display: 'flex', flexWrap: 'wrap', gap: '4px' },
  cueChip: {
    display: 'inline-block', padding: '1px 7px', borderRadius: '8px', border: '1px solid',
    fontSize: '10px', fontWeight: 600, whiteSpace: 'nowrap',
  },
  notesCell: { fontSize: '12px', color: colors.textSubtle, whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
};
