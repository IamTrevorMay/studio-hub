import React, { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import FullScreenSheet from '../components/mobile/FullScreenSheet';
import BottomSheet from '../components/mobile/BottomSheet';
import { mobileTokens, mobileTapButton } from '../utils/mobileTokens';

function newBeat() {
  return { id: crypto.randomUUID(), title: '', context: '', graphics: [], videos: [] };
}

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function ProductionMobile() {
  const { profile } = useAuth();
  const [sheets, setSheets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeSheet, setActiveSheet] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');

  const fetchSheets = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('beat_sheets')
      .select('*')
      .eq('is_archived', false)
      .order('updated_at', { ascending: false });
    setSheets(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { if (profile?.id) fetchSheets(); }, [profile?.id, fetchSheets]);

  async function createSheet(e) {
    e.preventDefault();
    if (!createName.trim() || !profile?.id) return;
    const { data, error } = await supabase
      .from('beat_sheets')
      .insert({ user_id: profile.id, title: createName.trim(), beats: [newBeat()] })
      .select()
      .single();
    if (error) { alert('Failed: ' + error.message); return; }
    setCreateName('');
    setShowCreate(false);
    setSheets((prev) => [data, ...prev]);
    setActiveSheet(data);
  }

  function handleSheetUpdated(updated) {
    setSheets((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  }

  return (
    <div style={styles.root}>
      <div style={styles.list}>
        {loading ? (
          <p style={styles.empty}>Loading…</p>
        ) : sheets.length === 0 ? (
          <div style={styles.emptyCard}>
            <p style={styles.emptyTitle}>No beat sheets yet</p>
            <p style={styles.emptyHint}>Tap "+ Beat sheet" to start.</p>
          </div>
        ) : (
          sheets.map((s) => (
            <button key={s.id} onClick={() => setActiveSheet(s)} style={styles.sheetCard}>
              <span style={styles.sheetIcon}>📋</span>
              <div style={styles.sheetBody}>
                <div style={styles.sheetTitle}>{s.title || 'Untitled'}</div>
                <div style={styles.sheetMeta}>
                  {Array.isArray(s.beats) ? `${s.beats.length} beat${s.beats.length === 1 ? '' : 's'}` : '0 beats'}
                  {s.updated_at && <> · {timeAgo(s.updated_at)}</>}
                </div>
              </div>
            </button>
          ))
        )}
      </div>

      <div style={{ ...styles.bottomBar, paddingBottom: `calc(${mobileTokens.space.md}px + ${mobileTokens.safeBottom})` }}>
        <button onClick={() => setShowCreate(true)} style={styles.createBtn}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M10 4v12M4 10h12" strokeLinecap="round" />
          </svg>
          <span>Beat sheet</span>
        </button>
      </div>

      <BottomSheet open={showCreate} onClose={() => setShowCreate(false)} title="New beat sheet">
        <form onSubmit={createSheet} style={addStyles.form}>
          <label style={addStyles.field}>
            <span style={addStyles.label}>Name</span>
            <input
              autoFocus
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="e.g. Q4 Launch Video"
              style={addStyles.input}
            />
          </label>
          <button type="submit" disabled={!createName.trim()} style={{ ...addStyles.saveBtn, opacity: createName.trim() ? 1 : 0.5 }}>
            Create
          </button>
        </form>
      </BottomSheet>

      <FullScreenSheet open={!!activeSheet} onClose={() => setActiveSheet(null)} title={activeSheet?.title || 'Beat sheet'}>
        {activeSheet && (
          <SheetEditor sheet={activeSheet} onSheetUpdated={handleSheetUpdated} />
        )}
      </FullScreenSheet>
    </div>
  );
}

function SheetEditor({ sheet, onSheetUpdated }) {
  const [title, setTitle] = useState(sheet.title || '');
  const [beats, setBeats] = useState(Array.isArray(sheet.beats) && sheet.beats.length ? sheet.beats : [newBeat()]);
  const [saveStatus, setSaveStatus] = useState('saved');
  const saveTimer = useRef(null);

  useEffect(() => () => clearTimeout(saveTimer.current), []);

  function scheduleSave(nextTitle, nextBeats) {
    setSaveStatus('unsaved');
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaveStatus('saving');
      const updated_at = new Date().toISOString();
      const { error } = await supabase
        .from('beat_sheets')
        .update({ title: nextTitle, beats: nextBeats, updated_at })
        .eq('id', sheet.id);
      if (error) {
        console.error('Save failed:', error);
        setSaveStatus('unsaved');
        return;
      }
      setSaveStatus('saved');
      onSheetUpdated && onSheetUpdated({ ...sheet, title: nextTitle, beats: nextBeats, updated_at });
    }, 800);
  }

  function updateTitle(v) {
    setTitle(v);
    scheduleSave(v, beats);
  }

  function updateBeat(id, patch) {
    const next = beats.map((b) => (b.id === id ? { ...b, ...patch } : b));
    setBeats(next);
    scheduleSave(title, next);
  }

  function addBeat() {
    const next = [...beats, newBeat()];
    setBeats(next);
    scheduleSave(title, next);
  }

  function deleteBeat(id) {
    const next = beats.filter((b) => b.id !== id);
    if (next.length === 0) next.push(newBeat());
    setBeats(next);
    scheduleSave(title, next);
  }

  return (
    <div style={editStyles.root}>
      <div style={editStyles.header}>
        <input
          value={title}
          onChange={(e) => updateTitle(e.target.value)}
          placeholder="Untitled"
          style={editStyles.titleInput}
        />
        <span style={{
          ...editStyles.saveStatus,
          color: saveStatus === 'saved' ? 'rgba(255,255,255,0.45)'
            : saveStatus === 'saving' ? '#a5b4fc' : '#fcd34d',
        }}>
          {saveStatus === 'saved' ? 'Saved' : saveStatus === 'saving' ? 'Saving…' : 'Edited'}
        </span>
      </div>

      <ol style={editStyles.beatList}>
        {beats.map((b, i) => (
          <li key={b.id} style={editStyles.beatCard}>
            <div style={editStyles.beatHeader}>
              <span style={editStyles.beatIndex}>Beat {i + 1}</span>
              {beats.length > 1 && (
                <button onClick={() => deleteBeat(b.id)} style={editStyles.beatDeleteBtn} aria-label="Delete beat">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </div>
            <input
              value={b.title || ''}
              onChange={(e) => updateBeat(b.id, { title: e.target.value })}
              placeholder="Title"
              style={editStyles.beatTitleInput}
            />
            <textarea
              value={b.context || ''}
              onChange={(e) => updateBeat(b.id, { context: e.target.value })}
              rows={4}
              placeholder="What happens here?"
              style={editStyles.beatContextInput}
            />
          </li>
        ))}
      </ol>

      <button onClick={addBeat} style={editStyles.addBtn}>
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M9 4v10M4 9h10" strokeLinecap="round" />
        </svg>
        <span>Add beat</span>
      </button>
    </div>
  );
}

const styles = {
  root: { display: 'flex', flexDirection: 'column', minHeight: '100%', background: '#0f0f1a', color: '#e2e8f0' },
  list: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: mobileTokens.space.sm,
    padding: `${mobileTokens.space.md}px ${mobileTokens.space.lg}px ${mobileTokens.space.xxxl}px`,
    overflowY: 'auto',
    WebkitOverflowScrolling: 'touch',
  },
  sheetCard: {
    ...mobileTapButton,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: mobileTokens.space.md,
    padding: mobileTokens.space.md,
    background: 'rgba(255,255,255,0.04)',
    color: '#e2e8f0',
    textAlign: 'left',
    borderRadius: mobileTokens.radius.md,
    minHeight: mobileTokens.tap + 14,
  },
  sheetIcon: { fontSize: 22, flexShrink: 0 },
  sheetBody: { flex: 1, minWidth: 0 },
  sheetTitle: {
    fontSize: mobileTokens.font.md,
    fontWeight: 600,
    color: '#fff',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  sheetMeta: {
    fontSize: mobileTokens.font.xs,
    color: 'rgba(255,255,255,0.5)',
    marginTop: 2,
  },
  empty: {
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'center',
    fontSize: mobileTokens.font.md,
    padding: mobileTokens.space.xxl,
    margin: 0,
  },
  emptyCard: {
    margin: mobileTokens.space.lg,
    padding: mobileTokens.space.xl,
    background: 'rgba(255,255,255,0.04)',
    borderRadius: mobileTokens.radius.lg,
    textAlign: 'center',
  },
  emptyTitle: { fontSize: mobileTokens.font.lg, fontWeight: 600, color: '#fff', margin: 0 },
  emptyHint: { fontSize: mobileTokens.font.sm, color: 'rgba(255,255,255,0.5)', margin: `${mobileTokens.space.sm}px 0 0` },
  bottomBar: {
    position: 'sticky',
    bottom: 0,
    padding: `${mobileTokens.space.md}px ${mobileTokens.space.lg}px`,
    background: 'rgba(15,15,30,0.96)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    borderTop: '1px solid rgba(255,255,255,0.06)',
  },
  createBtn: {
    ...mobileTapButton,
    width: '100%',
    minHeight: mobileTokens.tap + 6,
    padding: `${mobileTokens.space.md}px ${mobileTokens.space.lg}px`,
    background: 'linear-gradient(135deg, #6366f1, #818cf8)',
    color: '#fff',
    borderRadius: mobileTokens.radius.md,
    fontSize: mobileTokens.font.md,
    fontWeight: 600,
    flexDirection: 'row',
    gap: mobileTokens.space.sm,
  },
};

const addStyles = {
  form: { display: 'flex', flexDirection: 'column', gap: mobileTokens.space.lg },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: {
    fontSize: mobileTokens.font.xs,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  input: {
    height: mobileTokens.tap,
    padding: `0 ${mobileTokens.space.md}px`,
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: mobileTokens.radius.md,
    color: '#fff',
    fontSize: mobileTokens.font.base,
    outline: 'none',
    fontFamily: 'inherit',
  },
  saveBtn: {
    minHeight: mobileTokens.tap + 4,
    padding: mobileTokens.space.md,
    background: 'linear-gradient(135deg, #6366f1, #818cf8)',
    border: 'none',
    borderRadius: mobileTokens.radius.md,
    color: '#fff',
    fontSize: mobileTokens.font.base,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
};

const editStyles = {
  root: { display: 'flex', flexDirection: 'column', gap: mobileTokens.space.lg },
  header: { display: 'flex', alignItems: 'center', gap: mobileTokens.space.md },
  titleInput: {
    flex: 1,
    height: mobileTokens.tap,
    padding: `0 ${mobileTokens.space.md}px`,
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: mobileTokens.radius.md,
    color: '#fff',
    fontSize: mobileTokens.font.lg,
    fontWeight: 600,
    outline: 'none',
    fontFamily: 'inherit',
  },
  saveStatus: {
    fontSize: mobileTokens.font.xs,
    flexShrink: 0,
  },
  beatList: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: mobileTokens.space.md,
  },
  beatCard: {
    background: 'rgba(255,255,255,0.04)',
    borderRadius: mobileTokens.radius.md,
    padding: mobileTokens.space.md,
    display: 'flex',
    flexDirection: 'column',
    gap: mobileTokens.space.sm,
  },
  beatHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  beatIndex: {
    fontSize: 10,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.45)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  beatDeleteBtn: {
    width: 32,
    height: 32,
    border: 'none',
    background: 'transparent',
    color: 'rgba(255,255,255,0.4)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'inherit',
  },
  beatTitleInput: {
    height: mobileTokens.tap,
    padding: `0 ${mobileTokens.space.md}px`,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: mobileTokens.radius.sm,
    color: '#fff',
    fontSize: mobileTokens.font.md,
    fontWeight: 600,
    outline: 'none',
    fontFamily: 'inherit',
  },
  beatContextInput: {
    padding: mobileTokens.space.md,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: mobileTokens.radius.sm,
    color: '#e2e8f0',
    fontSize: mobileTokens.font.md,
    outline: 'none',
    fontFamily: 'inherit',
    resize: 'vertical',
    minHeight: 96,
    lineHeight: 1.45,
  },
  addBtn: {
    ...mobileTapButton,
    width: '100%',
    minHeight: mobileTokens.tap,
    padding: mobileTokens.space.md,
    background: 'rgba(99,102,241,0.12)',
    border: '1px dashed rgba(99,102,241,0.3)',
    borderRadius: mobileTokens.radius.md,
    color: '#a5b4fc',
    fontSize: mobileTokens.font.md,
    fontWeight: 600,
    flexDirection: 'row',
    gap: mobileTokens.space.sm,
  },
};
