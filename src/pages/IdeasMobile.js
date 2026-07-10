import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import useVisibilityRefresh from '../hooks/useVisibilityRefresh';

// Mobile Ideas page — one column per swipe pane. CSS scroll-snap drives
// the swipe; we just listen to scroll events to keep the dot indicator
// in sync. Cross-column drag is desktop-only; on phones the user moves
// an idea by editing its category from the row menu.

const CATEGORIES = [
  { key: 'mayday_videos',      label: 'Mayday Videos' },
  { key: 'tm_baseball_videos', label: 'TM Baseball' },
  { key: 'short_form_only',    label: 'Short Form' },
  { key: 'podcast_only',       label: 'Podcast' },
];
const CATEGORY_KEYS = CATEGORIES.map((c) => c.key);

// Maps Ideas columns to the `type` used by Projects cards.
const CATEGORY_TO_PROJECT_TYPE = {
  mayday_videos: 'mayday_video',
  tm_baseball_videos: 'tm_baseball_video',
  short_form_only: 'short_form',
  podcast_only: 'podcast',
};

const IDEA_FIELDS = 'id, text, checked, position, category, context, created_by, created_at, updated_at, creator:profiles!created_by(full_name)';

// Stable per-user name color, hashed from the profile id — same palette and
// hash as the desktop Ideas page so colors match across devices.
const USER_COLORS = ['#a5b4fc', '#86efac', '#fcd34d', '#f9a8d4', '#93c5fd', '#fca5a5', '#c4b5fd', '#5eead4', '#fdba74'];
function userColor(userId) {
  if (!userId) return 'rgba(255,255,255,0.3)';
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return USER_COLORS[h % USER_COLORS.length];
}

export default function IdeasMobile() {
  const { profile } = useAuth();
  const [byCategory, setByCategory] = useState(() =>
    Object.fromEntries(CATEGORY_KEYS.map((k) => [k, []])),
  );
  const [activeIdx, setActiveIdx] = useState(0);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [sending, setSending] = useState(false);
  const scrollerRef = useRef(null);

  const fetchAll = useCallback(async () => {
    const { data, error } = await supabase
      .from('write_ideas')
      .select(IDEA_FIELDS)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) { console.error('Ideas load error:', error); return; }
    const grouped = Object.fromEntries(CATEGORY_KEYS.map((k) => [k, []]));
    for (const row of data || []) {
      const k = CATEGORY_KEYS.includes(row.category) ? row.category : 'mayday_videos';
      grouped[k].push(row);
    }
    setByCategory(grouped);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useVisibilityRefresh(fetchAll);

  // Track which column is centered as the user swipes. Scroll-snap
  // handles the motion; we only read scrollLeft / clientWidth to
  // compute the index. requestAnimationFrame throttles the work.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let frame = null;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        const w = el.clientWidth || 1;
        const idx = Math.round(el.scrollLeft / w);
        setActiveIdx(Math.max(0, Math.min(CATEGORIES.length - 1, idx)));
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  function jumpTo(idx) {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ left: idx * el.clientWidth, behavior: 'smooth' });
  }

  async function addItem(category, text) {
    const trimmed = (text || '').trim();
    if (!trimmed || !profile?.id) return;
    const existing = byCategory[category] || [];
    const nextPosition = existing.length > 0
      ? Math.max(...existing.map((i) => i.position || 0)) + 1
      : 0;
    const { data, error } = await supabase
      .from('write_ideas')
      .insert({ text: trimmed, checked: false, position: nextPosition, category, created_by: profile.id })
      .select(IDEA_FIELDS)
      .single();
    if (error) { alert(`Could not save: ${error.message}`); return; }
    setByCategory((prev) => ({ ...prev, [category]: [...(prev[category] || []), data] }));
  }

  async function toggleItem(id) {
    const allItems = CATEGORY_KEYS.flatMap((k) => byCategory[k] || []);
    const current = allItems.find((i) => i.id === id);
    if (!current) return;
    const nextChecked = !current.checked;
    const cat = current.category;
    setByCategory((prev) => ({
      ...prev,
      [cat]: prev[cat].map((i) => (i.id === id ? { ...i, checked: nextChecked } : i)),
    }));
    const { error } = await supabase
      .from('write_ideas')
      .update({ checked: nextChecked, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) { console.error(error); fetchAll(); }
  }

  async function deleteItem(id, category) {
    const previous = byCategory[category];
    setByCategory((prev) => ({
      ...prev,
      [category]: prev[category].filter((i) => i.id !== id),
    }));
    const { error } = await supabase.from('write_ideas').delete().eq('id', id);
    if (error) {
      setByCategory((prev) => ({ ...prev, [category]: previous }));
    }
  }

  async function saveEdit(id, category, newText) {
    const trimmed = (newText || '').trim();
    if (!trimmed) return;
    const current = (byCategory[category] || []).find((i) => i.id === id);
    if (!current || current.text === trimmed) return;
    setByCategory((prev) => ({
      ...prev,
      [category]: prev[category].map((i) => (i.id === id ? { ...i, text: trimmed } : i)),
    }));
    const { error } = await supabase
      .from('write_ideas')
      .update({ text: trimmed, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) { console.error(error); fetchAll(); }
  }

  async function moveItem(id, fromCat, toCat) {
    if (fromCat === toCat) return;
    const fromList = byCategory[fromCat] || [];
    const item = fromList.find((i) => i.id === id);
    if (!item) return;
    const toList = byCategory[toCat] || [];
    const nextPosition = toList.length > 0
      ? Math.max(...toList.map((i) => i.position || 0)) + 1
      : 0;
    setByCategory((prev) => ({
      ...prev,
      [fromCat]: prev[fromCat].filter((i) => i.id !== id),
      [toCat]: [...(prev[toCat] || []), { ...item, category: toCat, position: nextPosition }],
    }));
    const { error } = await supabase
      .from('write_ideas')
      .update({ category: toCat, position: nextPosition, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) { console.error(error); fetchAll(); }
  }

  async function saveContext(id, category, newContext) {
    const value = (newContext || '').trim() || null;
    setByCategory((prev) => ({
      ...prev,
      [category]: prev[category].map((i) => (i.id === id ? { ...i, context: value } : i)),
    }));
    const { error } = await supabase
      .from('write_ideas')
      .update({ context: value, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) { console.error(error); fetchAll(); }
  }

  function toggleSelect(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  async function sendSelectedToProjects() {
    const items = CATEGORY_KEYS.flatMap((k) => byCategory[k] || []).filter((i) => selectedIds.has(i.id));
    if (items.length === 0 || sending) return;
    setSending(true);
    const rows = items.map((i) => ({
      name: i.text,
      type: CATEGORY_TO_PROJECT_TYPE[i.category] || 'mayday_video',
      status: 'queue',
      start_column: 'queue',
      notes: i.context || null,
      stage_config: {},
      created_by: profile?.id || null,
    }));
    const { error } = await supabase.from('projects').insert(rows);
    if (error) {
      alert(`Could not add to Projects: ${error.message}`);
      setSending(false);
      return;
    }
    // Project cards created — remove the exported ideas from the board.
    const ids = items.map((i) => i.id);
    const { error: delError } = await supabase.from('write_ideas').delete().in('id', ids);
    if (delError) console.error('Error removing exported ideas:', delError);
    setByCategory((prev) => {
      const next = {};
      for (const k of CATEGORY_KEYS) next[k] = (prev[k] || []).filter((i) => !selectedIds.has(i.id));
      return next;
    });
    setSending(false);
    exitSelectMode();
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div style={styles.titleRow}>
          <h1 style={styles.pageTitle}>{CATEGORIES[activeIdx].label}</h1>
          <span style={styles.countPill}>
            {(byCategory[CATEGORIES[activeIdx].key] || []).length}
          </span>
          <div style={{ flex: 1 }} />
          {selectMode ? (
            <>
              <button
                onClick={sendSelectedToProjects}
                disabled={selectedIds.size === 0 || sending}
                style={{
                  ...styles.addToProjectsBtn,
                  opacity: selectedIds.size === 0 || sending ? 0.4 : 1,
                }}
              >
                {sending ? 'Adding…' : `Add to Projects (${selectedIds.size})`}
              </button>
              <button onClick={exitSelectMode} style={styles.selectCancelBtn}>✕</button>
            </>
          ) : (
            <button onClick={() => setSelectMode(true)} style={styles.selectBtn}>Select</button>
          )}
        </div>
        <div style={styles.dots}>
          {CATEGORIES.map((c, i) => (
            <button
              key={c.key}
              onClick={() => jumpTo(i)}
              aria-label={`Show ${c.label}`}
              style={{
                ...styles.dot,
                ...(i === activeIdx ? styles.dotActive : {}),
              }}
            />
          ))}
        </div>
      </div>

      <div ref={scrollerRef} style={styles.scroller}>
        {CATEGORIES.map((cat) => (
          <Column
            key={cat.key}
            category={cat}
            allCategories={CATEGORIES}
            items={byCategory[cat.key] || []}
            onAdd={(text) => addItem(cat.key, text)}
            onToggle={toggleItem}
            onDelete={(id) => deleteItem(id, cat.key)}
            onSaveEdit={(id, text) => saveEdit(id, cat.key, text)}
            onMove={(id, toCat) => moveItem(id, cat.key, toCat)}
            onSaveContext={(id, text) => saveContext(id, cat.key, text)}
            selectMode={selectMode}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
          />
        ))}
      </div>
    </div>
  );
}

function Column({ category, allCategories, items, onAdd, onToggle, onDelete, onSaveEdit, onMove, onSaveContext, selectMode, selectedIds, onToggleSelect }) {
  const [showInput, setShowInput] = useState(false);
  const [newText, setNewText] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editingText, setEditingText] = useState('');
  const [menuFor, setMenuFor] = useState(null);
  const [contextEditingId, setContextEditingId] = useState(null);
  const [contextDraft, setContextDraft] = useState('');

  function openContextEditor(item) {
    setContextEditingId(item.id);
    setContextDraft(item.context || '');
  }

  function commitContext(id) {
    onSaveContext(id, contextDraft);
    setContextEditingId(null);
    setContextDraft('');
  }

  return (
    <section style={styles.column}>
      <div style={styles.list}>
        {items.length === 0 && !showInput && (
          <div style={styles.empty}>No ideas yet. Tap + to start.</div>
        )}
        {items.map((item) => {
          const isEditing = editingId === item.id;
          const isSelected = selectMode && selectedIds.has(item.id);
          return (
            <div
              key={item.id}
              style={{ ...styles.row, ...(isSelected ? styles.rowSelected : {}) }}
              onClick={selectMode ? () => onToggleSelect(item.id) : undefined}
            >
              {selectMode ? (
                <div
                  style={{
                    ...styles.check,
                    borderRadius: '50%',
                    ...(isSelected ? styles.checkOn : {}),
                  }}
                >
                  {isSelected ? '✓' : ''}
                </div>
              ) : (
                <button
                  onClick={() => onToggle(item.id)}
                  style={{ ...styles.check, ...(item.checked ? styles.checkOn : {}) }}
                  aria-label={item.checked ? 'Uncheck' : 'Check'}
                >
                  {item.checked ? '✓' : ''}
                </button>
              )}
              <div style={styles.rowMain}>
                {isEditing ? (
                  <input
                    autoFocus
                    value={editingText}
                    onChange={(e) => setEditingText(e.target.value)}
                    onBlur={() => { onSaveEdit(item.id, editingText); setEditingId(null); setEditingText(''); }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.target.blur(); }
                      if (e.key === 'Escape') { setEditingId(null); setEditingText(''); }
                    }}
                    style={styles.editInput}
                  />
                ) : (
                  <button
                    onClick={selectMode ? undefined : () => { setEditingId(item.id); setEditingText(item.text); }}
                    style={{
                      ...styles.text,
                      textDecoration: item.checked ? 'line-through' : 'none',
                      color: item.checked ? 'rgba(255,255,255,0.4)' : '#e2e8f0',
                      ...(selectMode ? { cursor: 'default', pointerEvents: 'none' } : {}),
                    }}
                  >
                    {item.text}
                  </button>
                )}
                {contextEditingId === item.id ? (
                  <div style={styles.contextEditWrap}>
                    <textarea
                      value={contextDraft}
                      onChange={(e) => setContextDraft(e.target.value)}
                      placeholder="Add notes, angles, references..."
                      style={styles.contextTextarea}
                      rows={4}
                      autoFocus
                    />
                    <div style={styles.contextBtnRow}>
                      <button onClick={() => commitContext(item.id)} style={styles.contextSaveBtn}>Save</button>
                      <button
                        onClick={() => { setContextEditingId(null); setContextDraft(''); }}
                        style={styles.contextCancelBtn}
                      >Cancel</button>
                    </div>
                  </div>
                ) : item.context ? (
                  <div
                    style={styles.contextText}
                    onClick={selectMode ? undefined : () => openContextEditor(item)}
                  >
                    {item.context}
                  </div>
                ) : null}
                <div style={styles.metaRow}>
                  <span style={{ ...styles.creatorName, color: userColor(item.created_by) }}>{item.creator?.full_name || 'Unknown'}</span>
                  {!selectMode && contextEditingId !== item.id && (
                    <button onClick={() => openContextEditor(item)} style={styles.contextLink}>
                      {item.context ? 'edit context' : '+ context'}
                    </button>
                  )}
                </div>
              </div>
              {!selectMode && (
                <button
                  onClick={() => setMenuFor(menuFor === item.id ? null : item.id)}
                  style={styles.menuBtn}
                  aria-label="More"
                >
                  ⋯
                </button>
              )}
              {menuFor === item.id && !selectMode && (
                <div style={styles.menu} onClick={(e) => e.stopPropagation()}>
                  {allCategories.filter((c) => c.key !== category.key).map((c) => (
                    <button
                      key={c.key}
                      style={styles.menuItem}
                      onClick={() => { onMove(item.id, c.key); setMenuFor(null); }}
                    >
                      Move to {c.label}
                    </button>
                  ))}
                  <button
                    style={{ ...styles.menuItem, color: '#f87171' }}
                    onClick={() => { onDelete(item.id); setMenuFor(null); }}
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {showInput && (
          <div style={styles.row}>
            <span style={styles.checkPlaceholder}>+</span>
            <input
              autoFocus
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              onBlur={() => {
                if (newText.trim()) { onAdd(newText); }
                setNewText(''); setShowInput(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  // Clear before onAdd so a fast second Enter can't re-read the
                  // same text and insert a duplicate.
                  const v = newText.trim();
                  if (v) { setNewText(''); onAdd(v); }
                  // Stay in input so the user can rattle off several ideas.
                }
                if (e.key === 'Escape') { setNewText(''); setShowInput(false); }
              }}
              placeholder="New idea…"
              style={styles.editInput}
            />
          </div>
        )}
      </div>

      <button onClick={() => setShowInput(true)} style={styles.fab} aria-label="Add idea">+</button>
    </section>
  );
}

const styles = {
  page: { height: '100%', display: 'flex', flexDirection: 'column', background: '#0f0f1a', color: '#e2e8f0' },
  header: { padding: '14px 16px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)' },
  titleRow: { display: 'flex', alignItems: 'center', gap: 10 },
  selectBtn: {
    padding: '6px 12px', background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8,
    color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
  },
  addToProjectsBtn: {
    padding: '6px 12px', background: '#6366f1', border: 'none',
    borderRadius: 8, color: '#fff', fontSize: 12, fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
  },
  selectCancelBtn: {
    padding: '6px 10px', background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8,
    color: 'rgba(255,255,255,0.6)', fontSize: 12,
    cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
  },
  pageTitle: { margin: 0, fontSize: 18, fontWeight: 700, color: '#fff' },
  countPill: {
    fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.6)',
    background: 'rgba(255,255,255,0.06)', borderRadius: 999, padding: '2px 8px',
    textTransform: 'uppercase', letterSpacing: 0.4,
  },
  dots: { display: 'flex', gap: 6, marginTop: 10, justifyContent: 'center' },
  dot: {
    width: 26, height: 4, borderRadius: 2,
    background: 'rgba(255,255,255,0.12)', border: 'none', padding: 0,
    cursor: 'pointer',
  },
  dotActive: { background: '#6366f1' },

  scroller: {
    flex: 1, minHeight: 0,
    display: 'flex', overflowX: 'auto', overflowY: 'hidden',
    scrollSnapType: 'x mandatory',
    WebkitOverflowScrolling: 'touch',
  },
  column: {
    flex: '0 0 100%', width: '100%',
    scrollSnapAlign: 'start', scrollSnapStop: 'always',
    display: 'flex', flexDirection: 'column', minHeight: 0, position: 'relative',
  },
  list: {
    flex: 1, minHeight: 0, overflowY: 'auto',
    padding: '12px 14px 80px',
    display: 'flex', flexDirection: 'column', gap: 6,
  },
  empty: { padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.35)', fontSize: 13 },
  row: {
    display: 'flex', alignItems: 'flex-start', gap: 10,
    padding: '10px 12px', background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10,
    position: 'relative',
  },
  rowSelected: {
    background: 'rgba(99,102,241,0.12)',
    border: '1px solid rgba(99,102,241,0.4)',
  },
  rowMain: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 },
  metaRow: { display: 'flex', alignItems: 'center', gap: 10 },
  creatorName: { fontSize: 11, color: 'rgba(255,255,255,0.3)' },
  contextLink: {
    background: 'none', border: 'none', color: 'rgba(165,180,252,0.7)',
    fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', padding: 0,
  },
  contextText: {
    fontSize: 12, color: 'rgba(255,255,255,0.5)',
    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
  },
  contextEditWrap: { display: 'flex', flexDirection: 'column', gap: 6 },
  contextTextarea: {
    width: '100%', padding: '8px 10px', background: 'rgba(0,0,0,0.25)',
    border: '1px solid rgba(99,102,241,0.4)', borderRadius: 8,
    color: '#fff', fontSize: 13, fontFamily: 'inherit', outline: 'none',
    resize: 'vertical', boxSizing: 'border-box',
  },
  contextBtnRow: { display: 'flex', gap: 6 },
  contextSaveBtn: {
    padding: '6px 14px', background: '#6366f1', border: 'none',
    borderRadius: 6, color: '#fff', fontSize: 12, fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit',
  },
  contextCancelBtn: {
    padding: '6px 14px', background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6,
    color: 'rgba(255,255,255,0.6)', fontSize: 12,
    cursor: 'pointer', fontFamily: 'inherit',
  },
  check: {
    flex: '0 0 24px', width: 24, height: 24,
    background: 'transparent', border: '1.5px solid rgba(255,255,255,0.25)',
    borderRadius: 6, color: '#fff', fontSize: 14, fontWeight: 700,
    cursor: 'pointer', fontFamily: 'inherit', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
  },
  checkOn: { background: '#6366f1', borderColor: '#6366f1' },
  checkPlaceholder: {
    flex: '0 0 24px', width: 24, height: 24, color: 'rgba(255,255,255,0.4)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
  },
  text: {
    flex: 1, textAlign: 'left', background: 'transparent', border: 'none',
    padding: 0, fontSize: 15, fontFamily: 'inherit', cursor: 'pointer',
    minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  editInput: {
    flex: 1, minWidth: 0, background: 'rgba(0,0,0,0.25)',
    border: '1px solid rgba(99,102,241,0.4)', borderRadius: 6,
    padding: '6px 10px', color: '#fff', fontSize: 15, outline: 'none',
    fontFamily: 'inherit',
  },
  menuBtn: {
    flex: '0 0 28px', width: 28, height: 28, background: 'transparent',
    border: 'none', color: 'rgba(255,255,255,0.5)', fontSize: 18,
    cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1,
  },
  menu: {
    position: 'absolute', top: '100%', right: 12, marginTop: 4,
    background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 8, padding: 4, zIndex: 10,
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)', minWidth: 200,
  },
  menuItem: {
    display: 'block', width: '100%', textAlign: 'left',
    background: 'none', border: 'none', borderRadius: 5,
    padding: '8px 10px', color: '#fff', fontSize: 13,
    cursor: 'pointer', fontFamily: 'inherit',
  },

  fab: {
    position: 'absolute', bottom: 16, right: 16,
    width: 52, height: 52, borderRadius: '50%',
    background: '#6366f1', color: '#fff', border: 'none',
    fontSize: 28, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
    boxShadow: '0 6px 18px rgba(99,102,241,0.45)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    lineHeight: 1,
  },
};
