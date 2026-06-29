import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import FullScreenSheet from '../components/mobile/FullScreenSheet';
import BottomSheet from '../components/mobile/BottomSheet';
import { mobileTokens, mobileTapButton } from '../utils/mobileTokens';

// Schema matches the desktop Production page: a beat sheet's `beats`
// jsonb is an ordered list of items where each item is either a beat
// or a segment that wraps its own beats[]. Keep field defaults aligned
// so a sheet edited on mobile still opens cleanly on desktop.

function newBeat() {
  return { id: crypto.randomUUID(), title: '', context: '', notes: '', graphics: [], videos: [] };
}

const SEGMENT_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b',
  '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#a855f7',
];

function newSegment() {
  return {
    type: 'segment',
    id: crypto.randomUUID(),
    title: '',
    color: SEGMENT_COLORS[Math.floor(Math.random() * SEGMENT_COLORS.length)],
    children: [newBeat()],
  };
}

function isSegment(item) { return item?.type === 'segment'; }

function countBeats(items) {
  let n = 0;
  for (const it of items || []) {
    if (isSegment(it)) n += (it.children || []).length;
    else n += 1;
  }
  return n;
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

export default function ProductionMobile({ initialSheetId, onSheetOpened }) {
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

  // Deep link: open a specific sheet when navigated here with a target id
  useEffect(() => {
    if (!initialSheetId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('beat_sheets').select('*').eq('id', initialSheetId).single();
      if (!cancelled && data) {
        setActiveSheet(data);
        window.history.replaceState({}, '', '/production/' + data.id);
      }
      if (onSheetOpened) onSheetOpened();
    })();
    return () => { cancelled = true; };
  }, [initialSheetId]); // eslint-disable-line

  // Restore sheet from URL on refresh (safety net when initialSheetId isn't provided)
  useEffect(() => {
    if (initialSheetId) return;
    const urlSheetId = window.location.pathname.replace(/^\/+/, '').split('/')[1];
    if (!urlSheetId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('beat_sheets').select('*').eq('id', urlSheetId).single();
      if (!cancelled && data) {
        setActiveSheet(data);
        window.history.replaceState({}, '', '/production/' + data.id);
      }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line

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
    window.history.replaceState({}, '', '/production/' + data.id);
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
            <button key={s.id} onClick={() => { setActiveSheet(s); window.history.replaceState({}, '', '/production/' + s.id); }} style={styles.sheetCard}>
              <span style={styles.sheetIcon}>📋</span>
              <div style={styles.sheetBody}>
                <div style={styles.sheetTitle}>{s.title || 'Untitled'}</div>
                <div style={styles.sheetMeta}>
                  {(() => {
                    const n = Array.isArray(s.beats) ? countBeats(s.beats) : 0;
                    return `${n} beat${n === 1 ? '' : 's'}`;
                  })()}
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

      <FullScreenSheet open={!!activeSheet} onClose={() => { window.history.replaceState({}, '', '/production'); setActiveSheet(null); }} title={activeSheet?.title || 'Beat sheet'}>
        {activeSheet && (
          <SheetEditor sheet={activeSheet} onSheetUpdated={handleSheetUpdated} />
        )}
      </FullScreenSheet>
    </div>
  );
}

function SheetEditor({ sheet, onSheetUpdated }) {
  const [title, setTitle] = useState(sheet.title || '');
  const [items, setItems] = useState(() =>
    Array.isArray(sheet.beats) && sheet.beats.length ? sheet.beats : [newBeat()],
  );
  const [saveStatus, setSaveStatus] = useState('saved');
  const [collapsedSegments, setCollapsedSegments] = useState(() => new Set());
  const [colorPickerFor, setColorPickerFor] = useState(null);
  const saveTimer = useRef(null);

  useEffect(() => () => clearTimeout(saveTimer.current), []);

  function scheduleSave(nextTitle, nextItems) {
    setSaveStatus('unsaved');
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaveStatus('saving');
      const updated_at = new Date().toISOString();
      const { error } = await supabase
        .from('beat_sheets')
        .update({ title: nextTitle, beats: nextItems, updated_at })
        .eq('id', sheet.id);
      if (error) { setSaveStatus('unsaved'); return; }
      setSaveStatus('saved');
      onSheetUpdated && onSheetUpdated({ ...sheet, title: nextTitle, beats: nextItems, updated_at });
    }, 800);
  }
  function commit(next) { setItems(next); scheduleSave(title, next); }
  function updateTitle(v) { setTitle(v); scheduleSave(v, items); }

  // ─── Beat mutations ────────────────────────────────────────
  function updateBeat(beatId, patch) {
    commit(items.map((it) => {
      if (isSegment(it)) return { ...it, children: it.children.map((b) => b.id === beatId ? { ...b, ...patch } : b) };
      return it.id === beatId ? { ...it, ...patch } : it;
    }));
  }
  function addBeatAt(segmentId) {
    if (segmentId) {
      commit(items.map((it) => isSegment(it) && it.id === segmentId
        ? { ...it, children: [...it.children, newBeat()] } : it));
    } else {
      commit([...items, newBeat()]);
    }
  }
  function deleteBeat(beatId) {
    const next = items
      .map((it) => isSegment(it)
        ? { ...it, children: it.children.filter((b) => b.id !== beatId) }
        : it.id === beatId ? null : it)
      .filter(Boolean);
    if (countBeats(next) === 0) commit([newBeat()]);
    else commit(next);
  }

  // ─── Beat media (graphics / videos) ────────────────────────
  async function uploadMedia(beatId, field, file) {
    if (!file) return;
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
    const path = `${beatId}/${field}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from('beat-media').upload(path, file, { upsert: false });
    if (error) { alert('Upload failed: ' + error.message); return; }
    const { data: pub } = supabase.storage.from('beat-media').getPublicUrl(path);
    const mediaObj = { url: pub.publicUrl, path, name: file.name };
    // Append to whichever bucket (graphics/videos) the caller is using.
    const beat = findBeat(items, beatId);
    if (!beat) return;
    updateBeat(beatId, { [field]: [...(beat[field] || []), mediaObj] });
  }
  function removeMedia(beatId, field, index) {
    const beat = findBeat(items, beatId);
    if (!beat) return;
    const arr = [...(beat[field] || [])];
    arr.splice(index, 1);
    updateBeat(beatId, { [field]: arr });
  }

  // ─── Segment mutations ─────────────────────────────────────
  function addSegment() { commit([...items, newSegment()]); }
  function updateSegment(segId, patch) {
    commit(items.map((it) => isSegment(it) && it.id === segId ? { ...it, ...patch } : it));
  }
  function deleteSegment(segId) {
    if (!window.confirm('Delete this segment and all its beats?')) return;
    const next = items.filter((it) => !(isSegment(it) && it.id === segId));
    if (countBeats(next) === 0) commit([newBeat()]);
    else commit(next);
  }
  function toggleCollapse(segId) {
    setCollapsedSegments((prev) => {
      const next = new Set(prev);
      if (next.has(segId)) next.delete(segId); else next.add(segId);
      return next;
    });
  }

  // ─── Drag-drop reorder ─────────────────────────────────────
  // Droppable ids: 'top' for the orphan-beat root + 'seg-<id>' for each
  // segment's child list. Beats can move within their list or hop across
  // any list. Segments themselves move only within 'top'.
  function handleDragEnd(result) {
    const { source, destination, draggableId } = result;
    if (!destination) return;
    const srcId = source.droppableId, dstId = destination.droppableId;
    if (srcId === dstId && source.index === destination.index) return;

    // Distinguish "segment dragged" vs "beat dragged" by id prefix.
    if (draggableId.startsWith('seg-')) {
      if (srcId !== 'top' || dstId !== 'top') return; // segments only at top
      const next = [...items];
      const [moved] = next.splice(source.index, 1);
      next.splice(destination.index, 0, moved);
      commit(next);
      return;
    }

    // Beat move. Resolve source list, splice out, splice in destination.
    const next = items.map((it) => isSegment(it) ? { ...it, children: [...it.children] } : it);
    const listOf = (id) => id === 'top' ? next : (next.find((it) => isSegment(it) && it.id === id.replace(/^seg-/, ''))?.children);
    const srcList = listOf(srcId);
    const dstList = listOf(dstId);
    if (!srcList || !dstList) return;
    // Beat draggable id is `beat-<beatid>` so we strip the prefix to
    // verify positions instead of trusting index alone.
    const beatId = draggableId.replace(/^beat-/, '');
    const srcIdx = srcList.findIndex((b) => !isSegment(b) && b.id === beatId);
    if (srcIdx === -1) return;
    const [moved] = srcList.splice(srcIdx, 1);
    let insertIdx = destination.index;
    // If we just removed an earlier item from the same list, react-beautiful-dnd
    // gives the destination index AFTER removal so we don't need to shift.
    dstList.splice(insertIdx, 0, moved);
    if (srcId === 'top' && srcList === next) {
      // top-level mutation already applied via next array.
    } else if (srcId !== 'top') {
      next.forEach((it) => { if (isSegment(it) && `seg-${it.id}` === srcId) it.children = srcList; });
    }
    if (dstId === 'top' && dstList === next) {
      // ditto
    } else if (dstId !== 'top') {
      next.forEach((it) => { if (isSegment(it) && `seg-${it.id}` === dstId) it.children = dstList; });
    }
    commit(next);
  }

  const totalBeats = useMemo(() => countBeats(items), [items]);

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

      <div style={editStyles.counter}>{totalBeats} beat{totalBeats === 1 ? '' : 's'}</div>

      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable droppableId="top" type="ANY">
          {(prov) => (
            <div ref={prov.innerRef} {...prov.droppableProps} style={editStyles.list}>
              {items.map((it, i) => isSegment(it) ? (
                <Draggable key={it.id} draggableId={`seg-${it.id}`} index={i}>
                  {(dragProv) => (
                    <div ref={dragProv.innerRef} {...dragProv.draggableProps} style={{ ...editStyles.segmentWrap, ...(dragProv.draggableProps.style || {}) }}>
                      <SegmentHeader
                        segment={it}
                        dragHandleProps={dragProv.dragHandleProps}
                        collapsed={collapsedSegments.has(it.id)}
                        onToggleCollapse={() => toggleCollapse(it.id)}
                        onRename={(v) => updateSegment(it.id, { title: v })}
                        onOpenColor={() => setColorPickerFor(colorPickerFor === it.id ? null : it.id)}
                        colorPickerOpen={colorPickerFor === it.id}
                        onPickColor={(c) => { updateSegment(it.id, { color: c }); setColorPickerFor(null); }}
                        onDelete={() => deleteSegment(it.id)}
                      />
                      {!collapsedSegments.has(it.id) && (
                        <BeatList
                          droppableId={`seg-${it.id}`}
                          beats={it.children || []}
                          accent={it.color}
                          onUpdate={updateBeat}
                          onDelete={deleteBeat}
                          onUpload={uploadMedia}
                          onRemoveMedia={removeMedia}
                          onAdd={() => addBeatAt(it.id)}
                        />
                      )}
                    </div>
                  )}
                </Draggable>
              ) : (
                <Draggable key={it.id} draggableId={`beat-${it.id}`} index={i}>
                  {(dragProv) => (
                    <div ref={dragProv.innerRef} {...dragProv.draggableProps} style={{ ...(dragProv.draggableProps.style || {}) }}>
                      <BeatCard
                        beat={it}
                        dragHandleProps={dragProv.dragHandleProps}
                        accent={null}
                        onUpdate={(patch) => updateBeat(it.id, patch)}
                        onDelete={() => deleteBeat(it.id)}
                        onUpload={(field, file) => uploadMedia(it.id, field, file)}
                        onRemoveMedia={(field, idx) => removeMedia(it.id, field, idx)}
                      />
                      <div style={editStyles.divider} />
                    </div>
                  )}
                </Draggable>
              ))}
              {prov.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>

      <div style={editStyles.addRow}>
        <button onClick={() => addBeatAt(null)} style={editStyles.addBtn}>
          <span>+</span><span>Beat</span>
        </button>
        <button onClick={addSegment} style={editStyles.addSegBtn}>
          <span>+</span><span>Segment</span>
        </button>
      </div>
    </div>
  );
}

function findBeat(items, beatId) {
  for (const it of items) {
    if (isSegment(it)) {
      const m = it.children?.find((b) => b.id === beatId);
      if (m) return m;
    } else if (it.id === beatId) return it;
  }
  return null;
}

// ─── Segment header ───────────────────────────────────────────

function SegmentHeader({ segment, dragHandleProps, collapsed, onToggleCollapse, onRename, onOpenColor, colorPickerOpen, onPickColor, onDelete }) {
  return (
    <div style={{ ...editStyles.segmentHeader, background: `${segment.color}22`, border: `1px solid ${segment.color}55` }}>
      <button {...dragHandleProps} style={editStyles.dragHandle} aria-label="Drag segment">⋮⋮</button>
      <button onClick={onToggleCollapse} style={{ ...editStyles.iconBtn, color: segment.color }} aria-label={collapsed ? 'Expand' : 'Collapse'}>
        {collapsed ? '▸' : '▾'}
      </button>
      <button onClick={onOpenColor} style={{ ...editStyles.colorSwatch, background: segment.color }} aria-label="Color" />
      <input
        value={segment.title || ''}
        onChange={(e) => onRename(e.target.value)}
        placeholder="Segment name"
        style={editStyles.segmentTitleInput}
      />
      <button onClick={onDelete} style={editStyles.deleteSegBtn} aria-label="Delete segment">×</button>
      {colorPickerOpen && (
        <div style={editStyles.colorPicker}>
          {SEGMENT_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => onPickColor(c)}
              style={{ ...editStyles.colorChoice, background: c, outline: c === segment.color ? '2px solid #fff' : 'none' }}
              aria-label={`Color ${c}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Beat list (used inside segments + at top level) ──────────

function BeatList({ droppableId, beats, accent, onUpdate, onDelete, onUpload, onRemoveMedia, onAdd }) {
  return (
    <Droppable droppableId={droppableId} type="ANY">
      {(prov) => (
        <div ref={prov.innerRef} {...prov.droppableProps} style={editStyles.beatList}>
          {beats.map((b, i) => (
            <Draggable key={b.id} draggableId={`beat-${b.id}`} index={i}>
              {(dragProv) => (
                <div ref={dragProv.innerRef} {...dragProv.draggableProps} style={{ ...(dragProv.draggableProps.style || {}) }}>
                  <BeatCard
                    beat={b}
                    dragHandleProps={dragProv.dragHandleProps}
                    accent={accent}
                    onUpdate={(patch) => onUpdate(b.id, patch)}
                    onDelete={() => onDelete(b.id)}
                    onUpload={(field, file) => onUpload(b.id, field, file)}
                    onRemoveMedia={(field, idx) => onRemoveMedia(b.id, field, idx)}
                  />
                  <div style={editStyles.divider} />
                </div>
              )}
            </Draggable>
          ))}
          {prov.placeholder}
          <button onClick={onAdd} style={editStyles.addBeatInSeg}>
            <span>+</span><span>Beat in segment</span>
          </button>
        </div>
      )}
    </Droppable>
  );
}

// ─── Beat card ────────────────────────────────────────────────

function BeatCard({ beat, dragHandleProps, accent, onUpdate, onDelete, onUpload, onRemoveMedia }) {
  return (
    <article style={{ ...editStyles.beatCard, borderLeft: accent ? `3px solid ${accent}` : '3px solid transparent' }}>
      <div style={editStyles.beatHeader}>
        <button {...dragHandleProps} style={editStyles.dragHandle} aria-label="Drag beat">⋮⋮</button>
        <span style={editStyles.beatIndex}>Beat</span>
        <span style={{ flex: 1 }} />
        <button onClick={onDelete} style={editStyles.beatDeleteBtn} aria-label="Delete beat">×</button>
      </div>
      <input
        value={beat.title || ''}
        onChange={(e) => onUpdate({ title: e.target.value })}
        placeholder="Title"
        style={editStyles.beatTitleInput}
      />
      <textarea
        value={beat.context || ''}
        onChange={(e) => onUpdate({ context: e.target.value })}
        rows={4}
        placeholder="What happens here?"
        style={editStyles.beatContextInput}
      />
      <textarea
        value={beat.notes || ''}
        onChange={(e) => onUpdate({ notes: e.target.value })}
        rows={2}
        placeholder="Notes"
        style={editStyles.beatNotesInput}
      />

      <MediaList
        label="Graphics"
        items={beat.graphics || []}
        accept="image/*"
        onPick={(file) => onUpload('graphics', file)}
        onRemove={(idx) => onRemoveMedia('graphics', idx)}
      />
      <MediaList
        label="Videos"
        items={beat.videos || []}
        accept="video/*"
        onPick={(file) => onUpload('videos', file)}
        onRemove={(idx) => onRemoveMedia('videos', idx)}
      />
    </article>
  );
}

function MediaList({ label, items, accept, onPick, onRemove }) {
  const inputRef = useRef(null);
  return (
    <div style={editStyles.mediaSection}>
      <div style={editStyles.mediaLabel}>{label} ({items.length})</div>
      {items.length > 0 && (
        <div style={editStyles.mediaChips}>
          {items.map((m, i) => (
            <div key={(m.path || m.url) + i} style={editStyles.mediaChip}>
              <a href={m.url} target="_blank" rel="noopener noreferrer" style={editStyles.mediaName}>
                {m.name || `${label} ${i + 1}`}
              </a>
              <button onClick={() => onRemove(i)} style={editStyles.mediaRemove} aria-label="Remove">×</button>
            </div>
          ))}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ''; }}
      />
      <button onClick={() => inputRef.current?.click()} style={editStyles.mediaAddBtn}>
        + Add {label.toLowerCase()}
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
    flex: 1,
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
  addSegBtn: {
    ...mobileTapButton,
    flex: 1,
    minHeight: mobileTokens.tap,
    padding: mobileTokens.space.md,
    background: 'rgba(168,85,247,0.12)',
    border: '1px dashed rgba(168,85,247,0.3)',
    borderRadius: mobileTokens.radius.md,
    color: '#c084fc',
    fontSize: mobileTokens.font.md,
    fontWeight: 600,
    flexDirection: 'row',
    gap: mobileTokens.space.sm,
  },
  addRow: { display: 'flex', gap: mobileTokens.space.sm },
  addBeatInSeg: {
    ...mobileTapButton,
    width: '100%',
    minHeight: 40,
    padding: '8px 12px',
    marginTop: 4,
    background: 'rgba(255,255,255,0.04)',
    border: '1px dashed rgba(255,255,255,0.12)',
    borderRadius: mobileTokens.radius.sm,
    color: 'rgba(255,255,255,0.55)',
    fontSize: mobileTokens.font.sm,
    fontWeight: 600,
    flexDirection: 'row',
    gap: 6,
  },
  list: { display: 'flex', flexDirection: 'column', gap: mobileTokens.space.md },
  counter: {
    fontSize: mobileTokens.font.xs, color: 'rgba(255,255,255,0.45)',
    fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  divider: {
    height: 1, background: 'rgba(255,255,255,0.06)',
    margin: `${mobileTokens.space.md}px 0 0`,
  },
  segmentWrap: { display: 'flex', flexDirection: 'column', gap: mobileTokens.space.sm, position: 'relative' },
  segmentHeader: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '8px 10px', borderRadius: mobileTokens.radius.md,
    position: 'relative',
  },
  segmentTitleInput: {
    flex: 1, minWidth: 0,
    background: 'transparent', border: 'none',
    color: '#fff', fontSize: mobileTokens.font.md, fontWeight: 700,
    outline: 'none', fontFamily: 'inherit',
  },
  colorSwatch: {
    width: 22, height: 22, borderRadius: '50%',
    border: '2px solid rgba(255,255,255,0.2)', cursor: 'pointer',
    flexShrink: 0,
  },
  colorPicker: {
    position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 6,
    background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: mobileTokens.radius.md, padding: 8,
    display: 'flex', flexWrap: 'wrap', gap: 6, zIndex: 5,
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
  },
  colorChoice: {
    width: 28, height: 28, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.15)',
    cursor: 'pointer',
  },
  deleteSegBtn: {
    width: 28, height: 28, border: 'none', background: 'transparent',
    color: 'rgba(255,255,255,0.5)', fontSize: 18, cursor: 'pointer',
    fontFamily: 'inherit', lineHeight: 1, flexShrink: 0,
  },
  iconBtn: {
    width: 28, height: 28, background: 'transparent', border: 'none',
    fontSize: 16, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
  },
  dragHandle: {
    width: 22, height: 28, background: 'transparent', border: 'none',
    color: 'rgba(255,255,255,0.35)', cursor: 'grab', fontSize: 14,
    fontFamily: 'inherit', flexShrink: 0, padding: 0,
    touchAction: 'none',
  },
  beatNotesInput: {
    padding: mobileTokens.space.md,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: mobileTokens.radius.sm,
    color: '#e2e8f0',
    fontSize: mobileTokens.font.sm,
    outline: 'none',
    fontFamily: 'inherit',
    resize: 'vertical',
    minHeight: 56,
    lineHeight: 1.45,
  },
  mediaSection: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 },
  mediaLabel: {
    fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.45)',
    letterSpacing: 0.5, textTransform: 'uppercase',
  },
  mediaChips: { display: 'flex', flexDirection: 'column', gap: 4 },
  mediaChip: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '6px 10px', background: 'rgba(99,102,241,0.1)',
    border: '1px solid rgba(99,102,241,0.25)',
    borderRadius: mobileTokens.radius.sm,
  },
  mediaName: {
    flex: 1, minWidth: 0, color: '#c7d2fe',
    fontSize: mobileTokens.font.sm, textDecoration: 'none',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  mediaRemove: {
    width: 22, height: 22, background: 'transparent', border: 'none',
    color: '#f87171', cursor: 'pointer', fontSize: 16,
    fontFamily: 'inherit', lineHeight: 1, flexShrink: 0,
  },
  mediaAddBtn: {
    ...mobileTapButton,
    minHeight: 36, padding: '6px 10px',
    background: 'transparent',
    border: '1px dashed rgba(255,255,255,0.15)',
    borderRadius: mobileTokens.radius.sm,
    color: 'rgba(255,255,255,0.55)',
    fontSize: mobileTokens.font.sm, fontWeight: 600,
    flexDirection: 'row',
  },
};
