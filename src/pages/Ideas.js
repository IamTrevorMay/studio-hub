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

// Maps Ideas columns to the `type` used by Projects cards.
const CATEGORY_TO_PROJECT_TYPE = {
  mayday_videos: 'mayday_video',
  tm_baseball_videos: 'tm_baseball_video',
  short_form_only: 'short_form',
  podcast_only: 'podcast',
};

const IDEA_FIELDS = 'id, text, checked, position, category, context, created_by, created_at, updated_at, creator:profiles!created_by(full_name)';

export default function Ideas() {
  const { profile } = useAuth();
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [sending, setSending] = useState(false);
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
      <header style={styles.header}>
        <div>
          <h1 style={styles.pageTitle}>Ideas</h1>
          <p style={styles.pageSubtitle}>
            Sort ideas across categories. Drag items to move them between columns.
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
        <div style={styles.boardRow}>
          {CATEGORIES.map((cat) => (
            <Column
              key={cat.key}
              category={cat}
              items={byCategory[cat.key] || []}
              onAdd={(text) => addItem(cat.key, text)}
              onToggle={toggleItem}
              onDelete={(id) => deleteItem(id, cat.key)}
              onSaveEdit={(id, text) => saveEdit(id, cat.key, text)}
              onSaveContext={(id, text) => saveContext(id, cat.key, text)}
              selectMode={selectMode}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
            />
          ))}
        </div>
      </DragDropContext>
    </div>
  );
}

function Column({ category, items, onAdd, onToggle, onDelete, onSaveEdit, onSaveContext, selectMode, selectedIds, onToggleSelect }) {
  const [showInput, setShowInput] = useState(false);
  const [newText, setNewText] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editingText, setEditingText] = useState('');
  const [contextEditingId, setContextEditingId] = useState(null);
  const [contextDraft, setContextDraft] = useState('');

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

  return (
    <div style={styles.column}>
      <div style={styles.columnHeader}>
        <div style={styles.columnTitleRow}>
          <span style={styles.columnTitle}>{category.label}</span>
          <span style={styles.columnCount}>{items.length}</span>
        </div>
        {!showInput && (
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

      <Droppable droppableId={category.key}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            style={{
              ...styles.list,
              ...(snapshot.isDraggingOver ? styles.listDraggingOver : {}),
            }}
          >
            {items.map((item, index) => (
              <Draggable key={item.id} draggableId={item.id} index={index}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.draggableProps}
                    style={{
                      ...styles.itemWrap,
                      ...(snapshot.isDragging
                        ? { boxShadow: '0 4px 16px rgba(0,0,0,0.3)', opacity: 0.95 }
                        : {}),
                      ...provided.draggableProps.style,
                    }}
                  >
                    <div
                      style={{
                        ...styles.item,
                        ...(selectMode ? styles.itemSelectable : {}),
                        ...(selectMode && selectedIds.has(item.id) ? styles.itemSelected : {}),
                      }}
                      onClick={selectMode ? () => onToggleSelect(item.id) : undefined}
                    >
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
                            ...styles.itemText,
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
                      {!selectMode && (
                        <button
                          onClick={() => onDelete(item.id)}
                          style={styles.deleteBtn}
                          title="Delete"
                        >✕</button>
                      )}
                    </div>
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
                        onClick={selectMode ? () => onToggleSelect(item.id) : () => openContextEditor(item)}
                        title={selectMode ? undefined : 'Click to edit context'}
                      >
                        {item.context}
                      </div>
                    ) : null}
                    <div style={styles.metaRow}>
                      <span style={styles.creatorName}>{item.creator?.full_name || 'Unknown'}</span>
                      {!selectMode && contextEditingId !== item.id && (
                        <button onClick={() => openContextEditor(item)} style={styles.contextLink}>
                          {item.context ? 'edit context' : '+ context'}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </Draggable>
            ))}
            {provided.placeholder}
            {items.length === 0 && !showInput && (
              <p style={styles.emptyText}>No ideas yet</p>
            )}
          </div>
        )}
      </Droppable>
    </div>
  );
}

const styles = {
  page: { padding: '32px 40px', minHeight: '100vh' },
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
  boardRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: '16px',
    alignItems: 'flex-start',
  },
  column: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '14px',
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
  },
  columnHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    marginBottom: '12px',
  },
  columnTitleRow: { display: 'flex', alignItems: 'baseline', gap: '8px', minWidth: 0 },
  columnTitle: {
    fontSize: '13px',
    fontWeight: 700,
    color: 'rgba(255,255,255,0.65)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  columnCount: { fontSize: '11px', color: 'rgba(255,255,255,0.35)', fontWeight: 600 },
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
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    minHeight: '60px',
    padding: '4px',
    borderRadius: '8px',
    transition: 'background 0.15s',
  },
  listDraggingOver: { background: 'rgba(99,102,241,0.06)' },
  itemWrap: { borderRadius: '6px' },
  item: { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 4px' },
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
  metaRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '0 4px 4px 34px',
  },
  creatorName: { fontSize: '11px', color: 'rgba(255,255,255,0.3)' },
  contextLink: {
    background: 'none',
    border: 'none',
    color: 'rgba(165,180,252,0.7)',
    fontSize: '11px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    padding: 0,
  },
  contextText: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.5)',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    padding: '0 4px 4px 34px',
    cursor: 'text',
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
  itemText: { flex: 1, fontSize: '13px', color: '#e2e8f0', cursor: 'text', wordBreak: 'break-word' },
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
  deleteBtn: {
    background: 'none',
    border: 'none',
    color: '#ef4444',
    cursor: 'pointer',
    fontSize: '12px',
    padding: '4px',
    opacity: 0.6,
  },
  emptyText: { color: 'rgba(255,255,255,0.35)', fontSize: '13px', margin: '8px 4px 4px 4px' },
};
