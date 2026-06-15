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

export default function IdeasMobile() {
  const { profile } = useAuth();
  const [byCategory, setByCategory] = useState(() =>
    Object.fromEntries(CATEGORY_KEYS.map((k) => [k, []])),
  );
  const [activeIdx, setActiveIdx] = useState(0);
  const scrollerRef = useRef(null);

  const fetchAll = useCallback(async () => {
    const { data, error } = await supabase
      .from('write_ideas')
      .select('id, text, checked, position, category, created_by, created_at, updated_at')
      .order('position', { ascending: true });
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
      .select('id, text, checked, position, category, created_by, created_at, updated_at')
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

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div style={styles.titleRow}>
          <h1 style={styles.pageTitle}>{CATEGORIES[activeIdx].label}</h1>
          <span style={styles.countPill}>
            {(byCategory[CATEGORIES[activeIdx].key] || []).length}
          </span>
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
          />
        ))}
      </div>
    </div>
  );
}

function Column({ category, allCategories, items, onAdd, onToggle, onDelete, onSaveEdit, onMove }) {
  const [showInput, setShowInput] = useState(false);
  const [newText, setNewText] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editingText, setEditingText] = useState('');
  const [menuFor, setMenuFor] = useState(null);

  return (
    <section style={styles.column}>
      <div style={styles.list}>
        {items.length === 0 && !showInput && (
          <div style={styles.empty}>No ideas yet. Tap + to start.</div>
        )}
        {items.map((item) => {
          const isEditing = editingId === item.id;
          return (
            <div key={item.id} style={styles.row}>
              <button
                onClick={() => onToggle(item.id)}
                style={{ ...styles.check, ...(item.checked ? styles.checkOn : {}) }}
                aria-label={item.checked ? 'Uncheck' : 'Check'}
              >
                {item.checked ? '✓' : ''}
              </button>
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
                  onClick={() => { setEditingId(item.id); setEditingText(item.text); }}
                  style={{
                    ...styles.text,
                    textDecoration: item.checked ? 'line-through' : 'none',
                    color: item.checked ? 'rgba(255,255,255,0.4)' : '#e2e8f0',
                  }}
                >
                  {item.text}
                </button>
              )}
              <button
                onClick={() => setMenuFor(menuFor === item.id ? null : item.id)}
                style={styles.menuBtn}
                aria-label="More"
              >
                ⋯
              </button>
              {menuFor === item.id && (
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
                  if (newText.trim()) { onAdd(newText); setNewText(''); }
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
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '10px 12px', background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10,
    position: 'relative',
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
