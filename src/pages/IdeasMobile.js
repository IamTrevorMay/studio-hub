import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import useVisibilityRefresh from '../hooks/useVisibilityRefresh';
import { colors } from '../lib/styleTokens';

// Mobile Ideas page — mirrors the desktop restructure: one shared list plus a
// shared "Up Next" bucket, with the old categories living on as multi-select
// tags. Each bucket is a swipe pane (CSS scroll-snap, same pattern as the old
// per-category panes); the row menu moves ideas between buckets.

const BUCKETS = [
  { key: 'up_next', label: 'Up Next' },
  { key: 'list', label: 'Ideas' },
];
const BUCKET_KEYS = BUCKETS.map((b) => b.key);

// Seeded tags still map to Projects types / the legacy `category` column
// (kept in sync with desktop). Custom tags map to neither.
// Mayday / Short Form ideas are Film Queue formats now — no project type.
const TAG_LABEL_TO_PROJECT_TYPE = {
  'Trevor May Baseball Videos': 'tm_baseball_video',
  'Podcast Only': 'podcast',
};
const TAG_LABEL_TO_CATEGORY = {
  'Mayday Videos': 'mayday_videos',
  'Trevor May Baseball Videos': 'tm_baseball_videos',
  'Short Form Only': 'short_form_only',
  'Podcast Only': 'podcast_only',
};
const PROJECT_TYPE_OPTIONS = [
  { value: 'tm_baseball_video', label: 'TM Baseball Video' },
  { value: 'podcast', label: 'Podcast' },
];

const TAG_COLOR_CHOICES = ['#f87171', '#fb923c', '#fbbf24', '#34d399', '#22d3ee', '#8fb4d8', '#93c5fd', '#c084fc', '#f9a8d4'];

const IDEA_FIELDS = 'id, text, checked, position, category, bucket, tag_ids, context, created_by, created_at, updated_at, creator:profiles!created_by(full_name)';

// Stable per-user name color, hashed from the profile id — same palette and
// hash as the desktop Ideas page so colors match across devices.
const USER_COLORS = ['#8fb4d8', '#86efac', '#fcd34d', '#f9a8d4', '#93c5fd', '#fca5a5', '#c4b5fd', '#5eead4', '#fdba74'];
function userColor(userId) {
  if (!userId) return 'rgba(255,255,255,0.3)';
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return USER_COLORS[h % USER_COLORS.length];
}

function fmtDateAdded(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const opts = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('en-US', opts);
}

export default function IdeasMobile() {
  const { profile } = useAuth();
  const [byBucket, setByBucket] = useState(() =>
    Object.fromEntries(BUCKET_KEYS.map((k) => [k, []])),
  );
  const [tags, setTags] = useState([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [sending, setSending] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [tagEditFor, setTagEditFor] = useState(null); // idea id with the tag sheet open
  const [typePicker, setTypePicker] = useState(null); // { items, ambiguous, choices }
  const scrollerRef = useRef(null);

  const fetchAll = useCallback(async () => {
    const [ideasRes, tagsRes] = await Promise.all([
      supabase
        .from('write_ideas')
        .select(IDEA_FIELDS)
        .order('position', { ascending: true })
        .order('created_at', { ascending: true }),
      supabase
        .from('idea_tags')
        .select('id, label, color, position')
        .order('position', { ascending: true })
        .order('created_at', { ascending: true }),
    ]);
    if (ideasRes.error) { console.error('Ideas load error:', ideasRes.error); return; }
    if (tagsRes.error) console.error('Idea tags load error:', tagsRes.error);
    else setTags(tagsRes.data || []);
    const grouped = Object.fromEntries(BUCKET_KEYS.map((k) => [k, []]));
    for (const row of ideasRes.data || []) {
      const k = BUCKET_KEYS.includes(row.bucket) ? row.bucket : 'list';
      grouped[k].push(row);
    }
    setByBucket(grouped);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useVisibilityRefresh(fetchAll);

  // Track which pane is centered as the user swipes. Scroll-snap
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
        setActiveIdx(Math.max(0, Math.min(BUCKETS.length - 1, idx)));
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

  function tagById(id) {
    return tags.find((t) => t.id === id);
  }

  function tagsForIdea(idea) {
    return (idea.tag_ids || []).map((id) => tagById(id)).filter(Boolean);
  }

  function categoryForTagIds(tagIds) {
    for (const id of tagIds || []) {
      const cat = TAG_LABEL_TO_CATEGORY[tagById(id)?.label];
      if (cat) return cat;
    }
    return 'mayday_videos';
  }

  function projectTypesFor(idea) {
    const types = [];
    for (const t of tagsForIdea(idea)) {
      const type = TAG_LABEL_TO_PROJECT_TYPE[t.label];
      if (type && !types.includes(type)) types.push(type);
    }
    return types;
  }

  function findIdea(id) {
    for (const k of BUCKET_KEYS) {
      const found = (byBucket[k] || []).find((i) => i.id === id);
      if (found) return found;
    }
    return null;
  }

  function patchIdea(id, patch) {
    setByBucket((prev) => {
      const next = {};
      for (const k of BUCKET_KEYS) next[k] = (prev[k] || []).map((i) => (i.id === id ? { ...i, ...patch } : i));
      return next;
    });
  }

  async function addItem({ text, context, tagIds }) {
    const trimmed = (text || '').trim();
    if (!trimmed || !profile?.id) return false;
    const existing = byBucket.list || [];
    const nextPosition = existing.length > 0
      ? Math.max(...existing.map((i) => i.position || 0)) + 1
      : 0;
    const { data, error } = await supabase
      .from('write_ideas')
      .insert({
        text: trimmed,
        checked: false,
        position: nextPosition,
        bucket: 'list',
        tag_ids: tagIds || [],
        category: categoryForTagIds(tagIds),
        context: (context || '').trim() || null,
        created_by: profile.id,
      })
      .select(IDEA_FIELDS)
      .single();
    if (error) { alert(`Could not save: ${error.message}`); return false; }
    setByBucket((prev) => ({ ...prev, list: [...(prev.list || []), data] }));
    return true;
  }

  async function toggleItem(id) {
    const current = findIdea(id);
    if (!current) return;
    const nextChecked = !current.checked;
    patchIdea(id, { checked: nextChecked });
    const { error } = await supabase
      .from('write_ideas')
      .update({ checked: nextChecked, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) { console.error(error); fetchAll(); }
  }

  async function deleteItem(id, bucket) {
    const previous = byBucket[bucket];
    setByBucket((prev) => ({
      ...prev,
      [bucket]: prev[bucket].filter((i) => i.id !== id),
    }));
    const { error } = await supabase.from('write_ideas').delete().eq('id', id);
    if (error) {
      setByBucket((prev) => ({ ...prev, [bucket]: previous }));
    }
  }

  async function saveEdit(id, newText) {
    const trimmed = (newText || '').trim();
    if (!trimmed) return;
    const current = findIdea(id);
    if (!current || current.text === trimmed) return;
    patchIdea(id, { text: trimmed });
    const { error } = await supabase
      .from('write_ideas')
      .update({ text: trimmed, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) { console.error(error); fetchAll(); }
  }

  async function moveItem(id, toBucket) {
    const fromBucket = toBucket === 'list' ? 'up_next' : 'list';
    const item = (byBucket[fromBucket] || []).find((i) => i.id === id);
    if (!item) return;
    const toList = byBucket[toBucket] || [];
    const nextPosition = toList.length > 0
      ? Math.max(...toList.map((i) => i.position || 0)) + 1
      : 0;
    setByBucket((prev) => ({
      ...prev,
      [fromBucket]: prev[fromBucket].filter((i) => i.id !== id),
      [toBucket]: [...(prev[toBucket] || []), { ...item, bucket: toBucket, position: nextPosition }],
    }));
    const { error } = await supabase
      .from('write_ideas')
      .update({ bucket: toBucket, position: nextPosition, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) { console.error(error); fetchAll(); }
  }

  async function saveContext(id, newContext) {
    const value = (newContext || '').trim() || null;
    patchIdea(id, { context: value });
    const { error } = await supabase
      .from('write_ideas')
      .update({ context: value, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) { console.error(error); fetchAll(); }
  }

  async function saveTags(id, tagIds) {
    patchIdea(id, { tag_ids: tagIds, category: categoryForTagIds(tagIds) });
    const { error } = await supabase
      .from('write_ideas')
      .update({
        tag_ids: tagIds,
        category: categoryForTagIds(tagIds),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
    if (error) { console.error(error); fetchAll(); }
  }

  async function createTag(label, color) {
    const trimmed = (label || '').trim();
    if (!trimmed) return null;
    const existing = tags.find((t) => t.label.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing;
    const nextPosition = tags.length > 0 ? Math.max(...tags.map((t) => t.position || 0)) + 1 : 0;
    const { data, error } = await supabase
      .from('idea_tags')
      .insert({ label: trimmed, color, position: nextPosition, created_by: profile?.id || null })
      .select('id, label, color, position')
      .single();
    if (error) {
      alert(`Could not create tag: ${error.message || 'unknown error'}`);
      return null;
    }
    setTags((prev) => [...prev, data]);
    return data;
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

  function requestSendToProjects() {
    const items = BUCKET_KEYS.flatMap((k) => byBucket[k] || []).filter((i) => selectedIds.has(i.id));
    if (items.length === 0 || sending) return;
    // Ideas whose tags map to exactly one project type go straight through;
    // zero or 2+ mapped types needs a human pick — same rule as desktop.
    const ambiguous = items.filter((i) => projectTypesFor(i).length !== 1);
    if (ambiguous.length > 0) {
      setTypePicker({
        items,
        ambiguous,
        choices: Object.fromEntries(ambiguous.map((i) => [i.id, projectTypesFor(i)[0] || 'mayday_video'])),
      });
      return;
    }
    sendToProjects(items, (i) => projectTypesFor(i)[0]);
  }

  async function sendToProjects(items, typeFor) {
    setSending(true);
    const rows = items.map((i) => ({
      name: i.text,
      type: typeFor(i) || 'mayday_video',
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
    const ids = new Set(items.map((i) => i.id));
    const { error: delError } = await supabase.from('write_ideas').delete().in('id', [...ids]);
    if (delError) console.error('Error removing exported ideas:', delError);
    setByBucket((prev) => {
      const next = {};
      for (const k of BUCKET_KEYS) next[k] = (prev[k] || []).filter((i) => !ids.has(i.id));
      return next;
    });
    setSending(false);
    setTypePicker(null);
    exitSelectMode();
  }

  const tagEditIdea = tagEditFor ? findIdea(tagEditFor) : null;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div style={styles.titleRow}>
          <h1 style={styles.pageTitle}>{BUCKETS[activeIdx].label}</h1>
          <span style={styles.countPill}>
            {(byBucket[BUCKETS[activeIdx].key] || []).length}
          </span>
          <div style={{ flex: 1 }} />
          {selectMode ? (
            <>
              <button
                onClick={requestSendToProjects}
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
          {BUCKETS.map((b, i) => (
            <button
              key={b.key}
              onClick={() => jumpTo(i)}
              aria-label={`Show ${b.label}`}
              style={{
                ...styles.dot,
                ...(i === activeIdx ? styles.dotActive : {}),
              }}
            />
          ))}
        </div>
      </div>

      <div ref={scrollerRef} style={styles.scroller}>
        {BUCKETS.map((b) => (
          <Pane
            key={b.key}
            bucket={b}
            items={byBucket[b.key] || []}
            emptyHint={b.key === 'up_next'
              ? 'Nothing queued. Move an idea here from its ⋯ menu.'
              : 'No ideas yet. Tap + to start.'}
            tagsForIdea={tagsForIdea}
            onToggle={toggleItem}
            onDelete={(id) => deleteItem(id, b.key)}
            onSaveEdit={saveEdit}
            onMove={moveItem}
            onSaveContext={saveContext}
            onEditTags={setTagEditFor}
            onAdd={b.key === 'list' ? () => setShowAddModal(true) : null}
            selectMode={selectMode}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
          />
        ))}
      </div>

      {showAddModal && (
        <Sheet onClose={() => setShowAddModal(false)}>
          <AddIdeaSheet
            tags={tags}
            onCreateTag={createTag}
            onSubmit={async (draft) => {
              const ok = await addItem(draft);
              if (ok) setShowAddModal(false);
            }}
            onClose={() => setShowAddModal(false)}
          />
        </Sheet>
      )}

      {tagEditIdea && (
        <Sheet onClose={() => setTagEditFor(null)}>
          <div style={styles.sheetTitle}>Tags</div>
          <div style={styles.sheetIdeaText}>{tagEditIdea.text}</div>
          <TagPicker
            tags={tags}
            selectedIds={tagEditIdea.tag_ids || []}
            onToggleTag={(tagId) => {
              const current = tagEditIdea.tag_ids || [];
              saveTags(
                tagEditIdea.id,
                current.includes(tagId) ? current.filter((t) => t !== tagId) : [...current, tagId],
              );
            }}
            onCreateTag={createTag}
          />
          <button onClick={() => setTagEditFor(null)} style={styles.sheetDoneBtn}>Done</button>
        </Sheet>
      )}

      {typePicker && (
        <Sheet onClose={() => setTypePicker(null)}>
          <div style={styles.sheetTitle}>Pick project types</div>
          <div style={styles.sheetHint}>
            These ideas don't map cleanly to a single project type from their tags — choose one for each.
          </div>
          <div style={styles.typePickList}>
            {typePicker.ambiguous.map((i) => (
              <div key={i.id} style={styles.typePickRow}>
                <div style={styles.typePickIdea}>{i.text}</div>
                <select
                  value={typePicker.choices[i.id]}
                  onChange={(e) => setTypePicker((prev) => ({
                    ...prev,
                    choices: { ...prev.choices, [i.id]: e.target.value },
                  }))}
                  style={styles.typeSelect}
                >
                  {PROJECT_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <button
            onClick={() => {
              const { items, choices } = typePicker;
              sendToProjects(items, (i) => choices[i.id] || projectTypesFor(i)[0]);
            }}
            disabled={sending}
            style={{ ...styles.sheetDoneBtn, opacity: sending ? 0.4 : 1 }}
          >
            {sending ? 'Adding…' : `Add to Projects (${typePicker.items.length})`}
          </button>
        </Sheet>
      )}
    </div>
  );
}

// Bottom sheet shared by add / tags / type-picker flows.
function Sheet({ children, onClose }) {
  return (
    <div style={styles.sheetOverlay} onClick={onClose}>
      <div style={styles.sheet} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function TagPicker({ tags, selectedIds, onToggleTag, onCreateTag }) {
  const [newLabel, setNewLabel] = useState('');
  const [newColor, setNewColor] = useState(TAG_COLOR_CHOICES[5]);
  const [creating, setCreating] = useState(false);

  async function commitCreate() {
    const trimmed = newLabel.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    const tag = await onCreateTag(trimmed, newColor);
    setCreating(false);
    if (tag) {
      if (!selectedIds.includes(tag.id)) onToggleTag(tag.id);
      setNewLabel('');
    }
  }

  return (
    <div>
      <div style={styles.tagPickerList}>
        {tags.map((t) => {
          const on = selectedIds.includes(t.id);
          return (
            <button
              key={t.id}
              onClick={() => onToggleTag(t.id)}
              style={{
                ...styles.tagChip,
                ...styles.tagPickerChip,
                background: on ? `${t.color}26` : 'rgba(255,255,255,0.04)',
                color: on ? t.color : 'rgba(255,255,255,0.45)',
                borderColor: on ? `${t.color}55` : 'rgba(255,255,255,0.1)',
              }}
            >
              {on ? '✓ ' : ''}{t.label}
            </button>
          );
        })}
      </div>
      <div style={styles.tagCreateRow}>
        <input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') commitCreate(); }}
          placeholder="New tag…"
          style={styles.tagCreateInput}
        />
        <button
          onClick={commitCreate}
          disabled={!newLabel.trim() || creating}
          style={{ ...styles.tagCreateBtn, opacity: newLabel.trim() && !creating ? 1 : 0.4 }}
        >Add</button>
      </div>
      {newLabel.trim() && (
        <div style={styles.tagColorRow}>
          {TAG_COLOR_CHOICES.map((c) => (
            <button
              key={c}
              onClick={() => setNewColor(c)}
              style={{
                ...styles.tagColorSwatch,
                background: c,
                outline: newColor === c ? '2px solid rgba(255,255,255,0.7)' : 'none',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AddIdeaSheet({ tags, onCreateTag, onSubmit, onClose }) {
  const [text, setText] = useState('');
  const [context, setContext] = useState('');
  const [tagIds, setTagIds] = useState([]);
  const [saving, setSaving] = useState(false);

  function toggleTag(id) {
    setTagIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  }

  async function commit() {
    if (!text.trim() || saving) return;
    setSaving(true);
    await onSubmit({ text, context, tagIds });
    setSaving(false);
  }

  return (
    <>
      <div style={styles.sheetTitle}>Add Idea</div>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What's the idea?"
        style={styles.sheetInput}
        autoFocus
      />
      <textarea
        value={context}
        onChange={(e) => setContext(e.target.value)}
        placeholder="Description (optional)…"
        style={styles.contextTextarea}
        rows={3}
      />
      <div style={styles.sheetSectionLabel}>Tags</div>
      <TagPicker tags={tags} selectedIds={tagIds} onToggleTag={toggleTag} onCreateTag={onCreateTag} />
      <div style={styles.sheetBtnRow}>
        <button
          onClick={commit}
          disabled={!text.trim() || saving}
          style={{ ...styles.sheetDoneBtn, flex: 1, marginTop: 0, opacity: text.trim() && !saving ? 1 : 0.4 }}
        >
          {saving ? 'Adding…' : 'Add Idea'}
        </button>
        <button onClick={onClose} style={styles.sheetCancelBtn}>Cancel</button>
      </div>
    </>
  );
}

function Pane({ bucket, items, emptyHint, tagsForIdea, onToggle, onDelete, onSaveEdit, onMove, onSaveContext, onEditTags, onAdd, selectMode, selectedIds, onToggleSelect }) {
  const [editingId, setEditingId] = useState(null);
  const [editingText, setEditingText] = useState('');
  const [menuFor, setMenuFor] = useState(null);
  const [contextEditingId, setContextEditingId] = useState(null);
  const [contextDraft, setContextDraft] = useState('');

  const otherBucket = BUCKETS.find((b) => b.key !== bucket.key);

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
        {items.length === 0 && (
          <div style={styles.empty}>{emptyHint}</div>
        )}
        {items.map((item) => {
          const isEditing = editingId === item.id;
          const isSelected = selectMode && selectedIds.has(item.id);
          const itemTags = tagsForIdea(item);
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
                {itemTags.length > 0 && (
                  <div style={styles.tagRow}>
                    {itemTags.map((t) => (
                      <span
                        key={t.id}
                        style={{ ...styles.tagChip, background: `${t.color}26`, color: t.color, borderColor: `${t.color}55` }}
                      >
                        {t.label}
                      </span>
                    ))}
                  </div>
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
                  <span style={styles.dateAdded}>{fmtDateAdded(item.created_at)}</span>
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
                  <button
                    style={styles.menuItem}
                    onClick={() => { onMove(item.id, otherBucket.key); setMenuFor(null); }}
                  >
                    Move to {otherBucket.label}
                  </button>
                  <button
                    style={styles.menuItem}
                    onClick={() => { onEditTags(item.id); setMenuFor(null); }}
                  >
                    Edit tags
                  </button>
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
      </div>

      {onAdd && !selectMode && (
        <button onClick={onAdd} style={styles.fab} aria-label="Add idea">+</button>
      )}
    </section>
  );
}

const styles = {
  page: { height: '100%', display: 'flex', flexDirection: 'column', background: colors.bg, color: colors.textBright },
  header: { padding: '14px 16px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)' },
  titleRow: { display: 'flex', alignItems: 'center', gap: 10 },
  selectBtn: {
    padding: '6px 12px', background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8,
    color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
  },
  addToProjectsBtn: {
    padding: '6px 12px', background: colors.accent, border: 'none',
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
  dotActive: { background: colors.accent },

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
    background: colors.accentA12,
    border: '1px solid rgba(91, 143, 199,0.4)',
  },
  rowMain: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 },
  metaRow: { display: 'flex', alignItems: 'center', gap: 10 },
  creatorName: { fontSize: 11, color: 'rgba(255,255,255,0.3)' },
  dateAdded: { fontSize: 11, color: 'rgba(255,255,255,0.3)', whiteSpace: 'nowrap' },
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
    border: '1px solid rgba(91, 143, 199,0.4)', borderRadius: 8,
    color: '#fff', fontSize: 13, fontFamily: 'inherit', outline: 'none',
    resize: 'vertical', boxSizing: 'border-box',
  },
  contextBtnRow: { display: 'flex', gap: 6 },
  contextSaveBtn: {
    padding: '6px 14px', background: colors.accent, border: 'none',
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
  checkOn: { background: colors.accent, borderColor: colors.accent },
  text: {
    flex: 1, textAlign: 'left', background: 'transparent', border: 'none',
    padding: 0, fontSize: 15, fontFamily: 'inherit', cursor: 'pointer',
    minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  editInput: {
    flex: 1, minWidth: 0, background: 'rgba(0,0,0,0.25)',
    border: '1px solid rgba(91, 143, 199,0.4)', borderRadius: 6,
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
    background: colors.bgHover, border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 8, padding: 4, zIndex: 10,
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)', minWidth: 200,
  },
  menuItem: {
    display: 'block', width: '100%', textAlign: 'left',
    background: 'none', border: 'none', borderRadius: 5,
    padding: '8px 10px', color: '#fff', fontSize: 13,
    cursor: 'pointer', fontFamily: 'inherit',
  },

  // ── Tags ──
  tagRow: { display: 'flex', flexWrap: 'wrap', gap: 4 },
  tagChip: {
    display: 'inline-block', padding: '2px 8px', borderRadius: 10,
    border: '1px solid', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
  },
  tagPickerChip: { cursor: 'pointer', fontFamily: 'inherit' },
  tagPickerList: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  tagCreateRow: { display: 'flex', gap: 6, marginTop: 10 },
  tagCreateInput: {
    flex: 1, minWidth: 0, padding: '7px 10px',
    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8, color: '#fff', fontSize: 13, fontFamily: 'inherit', outline: 'none',
  },
  tagCreateBtn: {
    padding: '7px 12px', background: colors.accent, border: 'none',
    borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit',
  },
  tagColorRow: { display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' },
  tagColorSwatch: {
    width: 22, height: 22, borderRadius: '50%', border: 'none',
    cursor: 'pointer', padding: 0,
  },

  // ── Bottom sheets ──
  sheetOverlay: {
    position: 'fixed', inset: 0, zIndex: 1100,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex', alignItems: 'flex-end',
  },
  sheet: {
    background: '#14141f',
    borderTop: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '16px 16px 0 0',
    padding: '18px 16px calc(18px + env(safe-area-inset-bottom))',
    width: '100%',
    maxHeight: '80vh',
    overflowY: 'auto',
    boxSizing: 'border-box',
  },
  sheetTitle: { fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 12 },
  sheetHint: { fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 12, lineHeight: 1.5 },
  sheetIdeaText: {
    fontSize: 13, color: 'rgba(255,255,255,0.6)', marginBottom: 12,
    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
  },
  sheetSectionLabel: {
    fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
    color: 'rgba(255,255,255,0.35)', margin: '14px 0 8px',
  },
  sheetInput: {
    width: '100%', padding: '9px 12px', marginBottom: 10,
    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8, color: '#fff', fontSize: 15, fontFamily: 'inherit',
    outline: 'none', boxSizing: 'border-box',
  },
  sheetBtnRow: { display: 'flex', gap: 8, marginTop: 16 },
  sheetDoneBtn: {
    display: 'block', width: '100%', marginTop: 16, padding: '10px 16px',
    background: colors.accent, border: 'none', borderRadius: 10,
    color: '#fff', fontSize: 14, fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit',
  },
  sheetCancelBtn: {
    padding: '10px 16px', background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10,
    color: 'rgba(255,255,255,0.6)', fontSize: 14,
    cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
  },
  typePickList: { display: 'flex', flexDirection: 'column', gap: 8 },
  typePickRow: {
    padding: 10, background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10,
    display: 'flex', flexDirection: 'column', gap: 8,
  },
  typePickIdea: { fontSize: 13, color: '#e2e8f0', wordBreak: 'break-word' },
  typeSelect: {
    padding: '8px 10px', background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8,
    color: '#e2e8f0', fontSize: 13, fontFamily: 'inherit', outline: 'none',
  },
};
