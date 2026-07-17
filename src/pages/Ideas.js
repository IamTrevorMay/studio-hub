import React, { useCallback, useEffect, useState } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import useVisibilityRefresh from '../hooks/useVisibilityRefresh';

const CATEGORIES = [
  { key: 'mayday_videos',      label: 'Mayday Videos' },
  { key: 'tm_baseball_videos', label: 'Trevor May Baseball Videos' },
  { key: 'short_form_only',    label: 'Short Form Only' },
  { key: 'podcast_only',       label: 'Podcast Only' },
];

const CATEGORY_KEYS = CATEGORIES.map((c) => c.key);

// Section-title colors matched to the content-type hues used elsewhere (the
// Projects board type chips in kanbanStages TYPE_COLORS).
const CATEGORY_COLORS = {
  mayday_videos: '#f87171',
  tm_baseball_videos: '#34d399',
  short_form_only: '#fbbf24',
  podcast_only: '#c084fc',
};

// Maps Ideas columns to the `type` used by Projects cards.
const CATEGORY_TO_PROJECT_TYPE = {
  mayday_videos: 'mayday_video',
  tm_baseball_videos: 'tm_baseball_video',
  short_form_only: 'short_form',
  podcast_only: 'podcast',
};

const IDEA_FIELDS = 'id, text, checked, position, category, context, potential_titles, created_by, created_at, updated_at, creator:profiles!created_by(full_name)';

// Ratings: admins + directors only — RLS on idea_ratings enforces the same
// set server-side, so other roles never receive rating rows at all.
const RATER_ROLES = ['admin', 'director_creative', 'director_comms'];
const RATING_COLORS = { 1: '#ef4444', 2: '#f97316', 3: '#facc15', 4: '#86efac', 5: '#22c55e' };
const MAX_TITLES = 5;

// Stable per-user name color, hashed from the profile id so desktop and
// mobile agree without storing anything.
const USER_COLORS = ['#a5b4fc', '#86efac', '#fcd34d', '#f9a8d4', '#93c5fd', '#fca5a5', '#c4b5fd', '#5eead4', '#fdba74'];
function userColor(userId) {
  if (!userId) return 'rgba(255,255,255,0.3)';
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return USER_COLORS[h % USER_COLORS.length];
}

export default function Ideas() {
  const { profile } = useAuth();
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [sending, setSending] = useState(false);
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y, id, category }
  // Items keyed by category for O(1) column lookup + per-column ordering.
  const [byCategory, setByCategory] = useState(() =>
    Object.fromEntries(CATEGORY_KEYS.map((k) => [k, []]))
  );

  const fetchAll = useCallback(async () => {
    const { data, error } = await supabase
      .from('write_ideas')
      .select(IDEA_FIELDS)
      // position is reindexed per-category, so add created_at as a deterministic
      // tiebreak — otherwise within-column order can shuffle between reloads.
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) {
      console.error('Error loading ideas:', error);
      return;
    }
    const grouped = Object.fromEntries(CATEGORY_KEYS.map((k) => [k, []]));
    for (const row of data || []) {
      const k = CATEGORY_KEYS.includes(row.category) ? row.category : 'mayday_videos';
      grouped[k].push(row);
    }
    setByCategory(grouped);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useVisibilityRefresh(fetchAll);

  async function handleDragEnd(result) {
    if (!result.destination) return;
    const srcKey = result.source.droppableId;
    const dstKey = result.destination.droppableId;
    if (!CATEGORY_KEYS.includes(srcKey) || !CATEGORY_KEYS.includes(dstKey)) return;
    if (srcKey === dstKey && result.source.index === result.destination.index) return;

    const next = { ...byCategory, [srcKey]: [...byCategory[srcKey]] };
    if (srcKey !== dstKey) next[dstKey] = [...byCategory[dstKey]];

    const [moved] = next[srcKey].splice(result.source.index, 1);
    if (!moved) return;

    if (srcKey !== dstKey) {
      // Update local copy so the moved item now carries the new category.
      moved.category = dstKey;
    }
    next[dstKey].splice(result.destination.index, 0, moved);

    // Reindex affected columns.
    const reindexedSrc = next[srcKey].map((item, idx) => ({ ...item, position: idx }));
    const reindexedDst = srcKey === dstKey
      ? reindexedSrc
      : next[dstKey].map((item, idx) => ({ ...item, position: idx, category: dstKey }));

    next[srcKey] = reindexedSrc;
    next[dstKey] = reindexedDst;
    setByCategory(next);

    const updates = [];
    for (const item of reindexedSrc) {
      updates.push(
        supabase.from('write_ideas')
          .update({ position: item.position, category: srcKey })
          .eq('id', item.id)
      );
    }
    if (srcKey !== dstKey) {
      for (const item of reindexedDst) {
        updates.push(
          supabase.from('write_ideas')
            .update({ position: item.position, category: dstKey })
            .eq('id', item.id)
        );
      }
    }
    const results = await Promise.all(updates);
    const firstError = results.find((r) => r.error)?.error;
    if (firstError) {
      console.error('Error reordering ideas:', firstError);
      fetchAll();
    }
  }

  async function addItem(category, text) {
    const trimmed = (text || '').trim();
    if (!trimmed) return;
    if (!profile?.id) {
      alert('Cannot add: not signed in.');
      return;
    }
    const existing = byCategory[category] || [];
    const nextPosition = existing.length > 0
      ? Math.max(...existing.map((i) => i.position || 0)) + 1
      : 0;
    const { data, error } = await supabase
      .from('write_ideas')
      .insert({
        text: trimmed,
        checked: false,
        position: nextPosition,
        category,
        created_by: profile.id,
      })
      .select(IDEA_FIELDS)
      .single();
    if (error) {
      console.error('Error adding idea:', error);
      alert(`Could not save idea: ${error.message || 'unknown error'}`);
      return;
    }
    setByCategory((prev) => ({ ...prev, [category]: [...(prev[category] || []), data] }));
  }

  async function toggleItem(id) {
    const allItems = CATEGORY_KEYS.flatMap((k) => byCategory[k] || []);
    const current = allItems.find((i) => i.id === id);
    if (!current) return;
    const nextChecked = !current.checked;
    setByCategory((prev) => {
      const next = { ...prev };
      const cat = current.category;
      next[cat] = next[cat].map((i) => (i.id === id ? { ...i, checked: nextChecked } : i));
      return next;
    });
    const { error } = await supabase
      .from('write_ideas')
      .update({ checked: nextChecked, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      console.error('Error toggling idea:', error);
      fetchAll();
    }
  }

  async function deleteItem(id, category) {
    const previous = byCategory[category];
    setByCategory((prev) => ({
      ...prev,
      [category]: prev[category].filter((i) => i.id !== id),
    }));
    const { error } = await supabase.from('write_ideas').delete().eq('id', id);
    if (error) {
      console.error('Error deleting idea:', error);
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
    if (error) {
      console.error('Error saving idea edit:', error);
      fetchAll();
    }
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
    if (error) {
      console.error('Error saving idea context:', error);
      fetchAll();
    }
  }

  // ── Potential titles (max 5, stored on the idea row) ──
  async function saveTitles(id, category, titles) {
    const clean = (titles || []).map((t) => String(t).trim()).filter(Boolean).slice(0, MAX_TITLES);
    setByCategory((prev) => ({
      ...prev,
      [category]: prev[category].map((i) => (i.id === id ? { ...i, potential_titles: clean } : i)),
    }));
    const { error } = await supabase
      .from('write_ideas')
      .update({ potential_titles: clean, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      console.error('Error saving titles:', error);
      fetchAll();
    }
  }

  // ── Ratings (admins + directors; RLS hides rows from everyone else) ──
  const canRate = RATER_ROLES.includes(profile?.role);
  const [ratingsByIdea, setRatingsByIdea] = useState({});

  useEffect(() => {
    if (!canRate) return undefined;
    let alive = true;
    (async () => {
      const { data, error } = await supabase
        .from('idea_ratings')
        .select('idea_id, user_id, rating, rater:profiles!user_id(full_name)');
      if (error) { console.error('Error fetching idea ratings:', error); return; }
      if (!alive) return;
      const grouped = {};
      for (const r of data || []) (grouped[r.idea_id] = grouped[r.idea_id] || []).push(r);
      setRatingsByIdea(grouped);
    })();
    return () => { alive = false; };
  }, [canRate]);

  async function rateIdea(ideaId, value) {
    if (!canRate || !profile?.id) return;
    const mine = (ratingsByIdea[ideaId] || []).find((r) => r.user_id === profile.id);
    if (mine && mine.rating === value) {
      // Clicking your current rating clears it.
      setRatingsByIdea((prev) => ({
        ...prev,
        [ideaId]: (prev[ideaId] || []).filter((r) => r.user_id !== profile.id),
      }));
      const { error } = await supabase.from('idea_ratings').delete().eq('idea_id', ideaId).eq('user_id', profile.id);
      if (error) console.error('Error clearing rating:', error);
      return;
    }
    setRatingsByIdea((prev) => ({
      ...prev,
      [ideaId]: [
        ...(prev[ideaId] || []).filter((r) => r.user_id !== profile.id),
        { idea_id: ideaId, user_id: profile.id, rating: value, rater: { full_name: profile.full_name } },
      ],
    }));
    const { error } = await supabase
      .from('idea_ratings')
      .upsert(
        { idea_id: ideaId, user_id: profile.id, rating: value, updated_at: new Date().toISOString() },
        { onConflict: 'idea_id,user_id' },
      );
    if (error) console.error('Error saving rating:', error);
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
    const rows = items.map((i) => {
      // Potential titles travel with the idea into the project's notes.
      const titles = (Array.isArray(i.potential_titles) ? i.potential_titles : []).filter(Boolean);
      const titleNote = titles.length ? `Potential titles:\n- ${titles.join('\n- ')}` : null;
      return {
        name: i.text,
        type: CATEGORY_TO_PROJECT_TYPE[i.category] || 'mayday_video',
        status: 'queue',
        start_column: 'queue',
        notes: [titleNote, i.context].filter(Boolean).join('\n\n') || null,
        stage_config: {},
        created_by: profile?.id || null,
      };
    });
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
      <header style={styles.header}>
        <div>
          <h1 style={styles.pageTitle}>Ideas</h1>
          <p style={styles.pageSubtitle}>
            Sort ideas across categories. Drag rows to move them between sections.
          </p>
        </div>
        <div style={styles.headerActions}>
          {selectMode ? (
            <>
              <button
                onClick={sendSelectedToProjects}
                disabled={selectedIds.size === 0 || sending}
                style={{
                  ...styles.addToProjectsBtn,
                  opacity: selectedIds.size === 0 || sending ? 0.4 : 1,
                  cursor: selectedIds.size === 0 || sending ? 'default' : 'pointer',
                }}
              >
                {sending ? 'Adding…' : `Add to Projects (${selectedIds.size})`}
              </button>
              <button onClick={exitSelectMode} style={styles.selectCancelBtn}>Cancel</button>
            </>
          ) : (
            <button onClick={() => setSelectMode(true)} style={styles.selectBtn}>Select</button>
          )}
        </div>
      </header>

      <DragDropContext onDragEnd={handleDragEnd}>
        <div style={styles.sectionsWrap}>
          {CATEGORIES.map((cat) => (
            <Section
              key={cat.key}
              category={cat}
              items={byCategory[cat.key] || []}
              onAdd={(text) => addItem(cat.key, text)}
              onToggle={toggleItem}
              onItemContextMenu={(e, item) => {
                e.preventDefault();
                setCtxMenu({ x: e.clientX, y: e.clientY, id: item.id, category: cat.key });
              }}
              onSaveEdit={(id, text) => saveEdit(id, cat.key, text)}
              onSaveContext={(id, text) => saveContext(id, cat.key, text)}
              onSaveTitles={(id, titles) => saveTitles(id, cat.key, titles)}
              canRate={canRate}
              currentUserId={profile?.id}
              ratingsByIdea={ratingsByIdea}
              onRate={rateIdea}
              selectMode={selectMode}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
            />
          ))}
        </div>
      </DragDropContext>

      {ctxMenu && (
        <>
          <div
            style={styles.ctxOverlay}
            onClick={() => setCtxMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null); }}
          />
          <div style={{ ...styles.ctxMenu, top: ctxMenu.y, left: ctxMenu.x }}>
            <button
              style={{ ...styles.ctxItem, color: '#f87171' }}
              onClick={() => { deleteItem(ctxMenu.id, ctxMenu.category); setCtxMenu(null); }}
            >
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Section({ category, items, onAdd, onToggle, onItemContextMenu, onSaveEdit, onSaveContext, onSaveTitles, canRate, currentUserId, ratingsByIdea, onRate, selectMode, selectedIds, onToggleSelect }) {
  const [showInput, setShowInput] = useState(false);
  const [newText, setNewText] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editingText, setEditingText] = useState('');
  const [contextEditingId, setContextEditingId] = useState(null);
  const [contextDraft, setContextDraft] = useState('');
  const [titleAddingId, setTitleAddingId] = useState(null);
  const [titleDraft, setTitleDraft] = useState('');

  // Grid template gains a Rating column only for rater roles.
  const grid = canRate ? styles.rowGridRate : styles.rowGrid;

  function commitNew() {
    onAdd(newText);
    setNewText('');
    setShowInput(false);
  }

  function commitEdit(id) {
    onSaveEdit(id, editingText);
    setEditingId(null);
    setEditingText('');
  }

  function openContextEditor(item) {
    setContextEditingId(item.id);
    setContextDraft(item.context || '');
  }

  function commitContext(id) {
    onSaveContext(id, contextDraft);
    setContextEditingId(null);
    setContextDraft('');
  }

  function commitTitle(item) {
    const trimmed = titleDraft.trim();
    const titles = Array.isArray(item.potential_titles) ? item.potential_titles : [];
    if (trimmed) onSaveTitles(item.id, [...titles, trimmed]);
    setTitleAddingId(null);
    setTitleDraft('');
  }

  return (
    <section style={styles.section}>
      <div style={styles.sectionHeader}>
        <span style={{ ...styles.sectionTitle, ...(CATEGORY_COLORS[category.key] ? { color: CATEGORY_COLORS[category.key] } : {}) }}>{category.label}</span>
        <span style={styles.sectionCount}>{items.length}</span>
        <div style={{ flex: 1 }} />
        {!showInput && !selectMode && (
          <button onClick={() => setShowInput(true)} style={styles.addBtn}>+ Add</button>
        )}
      </div>

      {showInput && (
        <div style={styles.addRow}>
          <input
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitNew();
              if (e.key === 'Escape') { setShowInput(false); setNewText(''); }
            }}
            placeholder="Add an idea..."
            style={styles.input}
            autoFocus
          />
          <button
            onClick={commitNew}
            disabled={!newText.trim()}
            style={{ ...styles.submitBtn, opacity: newText.trim() ? 1 : 0.4 }}
          >
            Add
          </button>
          <button
            onClick={() => { setShowInput(false); setNewText(''); }}
            style={styles.cancelBtn}
          >
            Cancel
          </button>
        </div>
      )}

      <div style={{ ...grid, ...styles.theadRow }}>
        <span />
        <span style={styles.th}>Idea</span>
        <span style={styles.th}>Description</span>
        <span style={styles.th}>Potential Titles</span>
        {canRate && <span style={styles.th}>Rating</span>}
        <span style={styles.th}>Added by</span>
      </div>

      <Droppable droppableId={category.key}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            style={snapshot.isDraggingOver ? styles.listDraggingOver : undefined}
          >
            {items.map((item, index) => {
              const titles = Array.isArray(item.potential_titles) ? item.potential_titles : [];
              const ratings = ratingsByIdea[item.id] || [];
              const mine = ratings.find((r) => r.user_id === currentUserId);
              const avg = ratings.length ? ratings.reduce((s, r) => s + r.rating, 0) / ratings.length : null;
              return (
                <Draggable key={item.id} draggableId={item.id} index={index}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.draggableProps}
                      onClick={selectMode ? () => onToggleSelect(item.id) : undefined}
                      onContextMenu={selectMode ? undefined : (e) => onItemContextMenu(e, item)}
                      style={{
                        ...grid,
                        ...styles.tr,
                        ...(selectMode ? styles.itemSelectable : {}),
                        ...(selectMode && selectedIds.has(item.id) ? styles.itemSelected : {}),
                        ...(snapshot.isDragging
                          ? { boxShadow: '0 4px 16px rgba(0,0,0,0.3)', opacity: 0.95, background: '#1a1a28' }
                          : {}),
                        ...provided.draggableProps.style,
                      }}
                    >
                      <div style={styles.cellCheck}>
                        <div
                          {...provided.dragHandleProps}
                          style={{ ...styles.dragHandle, ...(selectMode ? { display: 'none' } : {}) }}
                        >⠿</div>
                        {selectMode ? (
                          <div
                            style={{
                              ...styles.selectCircle,
                              ...(selectedIds.has(item.id) ? styles.selectCircleOn : {}),
                            }}
                          >
                            {selectedIds.has(item.id) ? '✓' : ''}
                          </div>
                        ) : (
                          <input
                            type="checkbox"
                            checked={item.checked}
                            onChange={() => onToggle(item.id)}
                            style={styles.checkbox}
                          />
                        )}
                      </div>

                      <div style={styles.cell}>
                        {editingId === item.id ? (
                          <input
                            value={editingText}
                            onChange={(e) => setEditingText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitEdit(item.id);
                              if (e.key === 'Escape') { setEditingId(null); setEditingText(''); }
                            }}
                            onBlur={() => commitEdit(item.id)}
                            style={styles.editInput}
                            autoFocus
                          />
                        ) : (
                          <span
                            style={{
                              ...styles.ideaText,
                              textDecoration: item.checked ? 'line-through' : 'none',
                              opacity: item.checked ? 0.45 : 1,
                            }}
                            onDoubleClick={selectMode ? undefined : () => {
                              setEditingId(item.id);
                              setEditingText(item.text);
                            }}
                            title={selectMode ? undefined : 'Double-click to edit'}
                          >
                            {item.text}
                          </span>
                        )}
                      </div>

                      <div style={styles.cell}>
                        {contextEditingId === item.id ? (
                          <div style={styles.contextEditWrap}>
                            <textarea
                              value={contextDraft}
                              onChange={(e) => setContextDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') { setContextEditingId(null); setContextDraft(''); }
                              }}
                              placeholder="Add notes, angles, references..."
                              style={styles.contextTextarea}
                              rows={3}
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
                            style={styles.descText}
                            onClick={selectMode ? undefined : () => openContextEditor(item)}
                            title={selectMode ? undefined : 'Click to edit'}
                          >
                            {item.context}
                          </div>
                        ) : (!selectMode && (
                          <button onClick={() => openContextEditor(item)} style={styles.cellAddLink}>+ add</button>
                        ))}
                      </div>

                      <div style={{ ...styles.cell, ...styles.titlesCell }}>
                        {titles.map((t, ti) => (
                          <div key={`${t}-${ti}`} style={styles.titleRow}>
                            <span style={styles.titleText}>{t}</span>
                            {!selectMode && (
                              <button
                                onClick={() => onSaveTitles(item.id, titles.filter((_, j) => j !== ti))}
                                style={styles.titleRemove}
                              >&times;</button>
                            )}
                          </div>
                        ))}
                        {titleAddingId === item.id ? (
                          <input
                            value={titleDraft}
                            onChange={(e) => setTitleDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitTitle(item);
                              if (e.key === 'Escape') { setTitleAddingId(null); setTitleDraft(''); }
                            }}
                            onBlur={() => commitTitle(item)}
                            placeholder="Potential title…"
                            style={styles.titleInput}
                            autoFocus
                          />
                        ) : (!selectMode && titles.length < MAX_TITLES && (
                          <button
                            onClick={() => { setTitleAddingId(item.id); setTitleDraft(''); }}
                            style={styles.titleAddBtn}
                          >+</button>
                        ))}
                      </div>

                      {canRate && (
                        <div
                          style={{ ...styles.cell, ...styles.ratingCell }}
                          onClick={selectMode ? undefined : (e) => e.stopPropagation()}
                        >
                          {avg != null && (
                            <span
                              style={{
                                ...styles.ratingAvg,
                                background: `${RATING_COLORS[Math.round(avg)]}26`,
                                color: RATING_COLORS[Math.round(avg)],
                              }}
                              title={ratings.map((r) => `${r.rater?.full_name || 'Unknown'}: ${r.rating}`).join('\n')}
                            >
                              {avg.toFixed(1)}
                            </span>
                          )}
                          {!selectMode && (
                            <div style={styles.ratingDots}>
                              {[1, 2, 3, 4, 5].map((n) => (
                                <button
                                  key={n}
                                  onClick={() => onRate(item.id, n)}
                                  title={`Rate ${n}${mine?.rating === n ? ' (click to clear)' : ''}`}
                                  style={{
                                    ...styles.ratingDot,
                                    borderColor: RATING_COLORS[n],
                                    background: mine && n <= mine.rating ? RATING_COLORS[n] : 'transparent',
                                  }}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      <div style={styles.cell}>
                        <span style={{ ...styles.creatorName, color: userColor(item.created_by) }}>
                          {item.creator?.full_name || 'Unknown'}
                        </span>
                      </div>
                    </div>
                  )}
                </Draggable>
              );
            })}
            {provided.placeholder}
            {items.length === 0 && !showInput && (
              <p style={styles.emptyText}>No ideas yet</p>
            )}
          </div>
        )}
      </Droppable>
    </section>
  );
}

const styles = {
  page: { padding: '36px 40px 64px', maxWidth: '1500px', margin: '0 auto', minHeight: '100vh' },
  header: {
    marginBottom: '24px',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '16px',
    flexWrap: 'wrap',
  },
  headerActions: { display: 'flex', gap: '8px', flexShrink: 0 },
  selectBtn: {
    padding: '8px 16px',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '8px',
    color: 'rgba(255,255,255,0.75)',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  addToProjectsBtn: {
    padding: '8px 16px',
    background: '#6366f1',
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '13px',
    fontWeight: 600,
    fontFamily: 'inherit',
  },
  selectCancelBtn: {
    padding: '8px 16px',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    color: 'rgba(255,255,255,0.6)',
    fontSize: '13px',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  pageTitle: { fontSize: '28px', fontWeight: 700, color: '#ffffff', margin: '0 0 6px 0', letterSpacing: '-0.5px' },
  pageSubtitle: { fontSize: '13px', color: 'rgba(255,255,255,0.45)', margin: 0 },
  addBtn: {
    padding: '4px 10px',
    background: 'rgba(99,102,241,0.15)',
    border: '1px solid rgba(99,102,241,0.3)',
    borderRadius: '6px',
    color: '#a5b4fc',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    flexShrink: 0,
  },
  addRow: { display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' },
  input: {
    flex: '1 1 100%',
    padding: '8px 12px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '13px',
    fontFamily: 'inherit',
    outline: 'none',
    boxSizing: 'border-box',
  },
  submitBtn: {
    flex: 1,
    padding: '8px 14px',
    background: '#6366f1',
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  cancelBtn: {
    flex: 1,
    padding: '8px 14px',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    color: 'rgba(255,255,255,0.6)',
    fontSize: '13px',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  listDraggingOver: { background: 'rgba(99,102,241,0.06)' },
  itemSelectable: { cursor: 'pointer', borderRadius: '6px' },
  itemSelected: { background: 'rgba(99,102,241,0.12)' },
  selectCircle: {
    width: '16px',
    height: '16px',
    borderRadius: '50%',
    border: '1.5px solid rgba(255,255,255,0.3)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '10px',
    color: '#fff',
    flexShrink: 0,
    boxSizing: 'border-box',
  },
  selectCircleOn: {
    background: '#6366f1',
    border: '1.5px solid #6366f1',
  },
  creatorName: { fontSize: '11px', color: 'rgba(255,255,255,0.3)' },
  // ── Table layout (sections per category) ──
  sectionsWrap: { display: 'flex', flexDirection: 'column', gap: '28px' },
  section: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: '12px',
    padding: '14px 16px 16px',
  },
  sectionHeader: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' },
  sectionTitle: { fontSize: '15px', fontWeight: 700, color: '#e2e8f0' },
  sectionCount: {
    fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.4)',
    background: 'rgba(255,255,255,0.06)', padding: '2px 8px', borderRadius: '10px',
  },
  rowGrid: {
    display: 'grid',
    gridTemplateColumns: '52px minmax(180px, 1.2fr) minmax(180px, 1.2fr) minmax(160px, 1fr) 120px',
    gap: '12px',
    alignItems: 'start',
  },
  rowGridRate: {
    display: 'grid',
    gridTemplateColumns: '52px minmax(180px, 1.2fr) minmax(180px, 1.2fr) minmax(160px, 1fr) 128px 120px',
    gap: '12px',
    alignItems: 'start',
  },
  theadRow: {
    padding: '4px 10px 8px',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
  },
  th: {
    fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
    color: 'rgba(255,255,255,0.35)',
  },
  tr: {
    padding: '10px',
    borderBottom: '1px solid rgba(255,255,255,0.05)',
    borderRadius: '8px',
  },
  cell: { minWidth: 0 },
  cellCheck: { display: 'flex', alignItems: 'center', gap: '6px' },
  ideaText: {
    fontSize: '13px', color: '#e2e8f0', cursor: 'default',
    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
  },
  descText: {
    fontSize: '12px', color: 'rgba(255,255,255,0.55)', lineHeight: 1.45,
    whiteSpace: 'pre-wrap', wordBreak: 'break-word', cursor: 'pointer',
  },
  cellAddLink: {
    background: 'none', border: 'none', color: 'rgba(165,180,252,0.55)',
    fontSize: '11px', cursor: 'pointer', fontFamily: 'inherit', padding: 0,
  },
  titlesCell: { display: 'flex', flexDirection: 'column', gap: '4px' },
  ratingCell: { display: 'flex', flexDirection: 'column', gap: '5px', alignItems: 'flex-start' },
  ratingDots: { display: 'flex', gap: '3px' },
  // ── Ratings (admins + directors only) ──
  ratingAvg: {
    fontSize: '10px', fontWeight: 700, padding: '1px 5px', borderRadius: 8,
    marginRight: 2, cursor: 'default',
  },
  ratingDot: {
    width: 11, height: 11, borderRadius: '50%', border: '1.5px solid',
    padding: 0, cursor: 'pointer', background: 'transparent',
  },
  // ── Potential Titles ──
  titleRow: {
    display: 'flex', alignItems: 'center', gap: 6, padding: '3px 8px',
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 6,
  },
  titleText: { fontSize: '12px', color: '#cbd5e1', flex: 1, wordBreak: 'break-word' },
  titleRemove: {
    background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)',
    fontSize: '13px', cursor: 'pointer', padding: 0, lineHeight: 1,
  },
  titleInput: {
    padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(99,102,241,0.35)',
    background: 'rgba(255,255,255,0.05)', color: '#e2e8f0', fontSize: '12px',
    fontFamily: 'inherit', outline: 'none',
  },
  titleAddBtn: {
    background: 'none', border: '1px dashed rgba(99,102,241,0.3)', borderRadius: 6,
    color: 'rgba(165,180,252,0.6)', fontSize: '11px', padding: '3px 8px',
    cursor: 'pointer', fontFamily: 'inherit', width: 'fit-content',
  },
  contextEditWrap: { padding: '4px 4px 6px 34px' },
  contextTextarea: {
    width: '100%',
    padding: '8px 10px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(99,102,241,0.4)',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '12px',
    fontFamily: 'inherit',
    outline: 'none',
    resize: 'vertical',
    boxSizing: 'border-box',
  },
  contextBtnRow: { display: 'flex', gap: '6px', marginTop: '6px' },
  contextSaveBtn: {
    padding: '5px 12px',
    background: '#6366f1',
    border: 'none',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  contextCancelBtn: {
    padding: '5px 12px',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '6px',
    color: 'rgba(255,255,255,0.6)',
    fontSize: '12px',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  dragHandle: {
    color: 'rgba(255,255,255,0.2)',
    fontSize: '14px',
    cursor: 'grab',
    userSelect: 'none',
    lineHeight: 1,
    paddingRight: '2px',
  },
  checkbox: { width: '14px', height: '14px', cursor: 'pointer' },
  editInput: {
    flex: 1,
    padding: '4px 8px',
    background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(99,102,241,0.5)',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '13px',
    fontFamily: 'inherit',
    outline: 'none',
  },
  ctxOverlay: { position: 'fixed', inset: 0, zIndex: 999 },
  ctxMenu: {
    position: 'fixed',
    zIndex: 1000,
    background: '#1e1e32',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '10px',
    padding: '4px',
    minWidth: '140px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
  },
  ctxItem: {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    background: 'none',
    border: 'none',
    borderRadius: '6px',
    padding: '8px 12px',
    color: '#e2e8f0',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  emptyText: { color: 'rgba(255,255,255,0.35)', fontSize: '13px', margin: '8px 4px 4px 4px' },
};
