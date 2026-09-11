import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import useVisibilityRefresh from '../hooks/useVisibilityRefresh';
import { callEdgeFn } from '../lib/edgeFn';
import { QUEUE_TYPES, IDEA_TAG_TO_QUEUE_TYPE } from '../lib/filmQueue';
import { colors } from '../lib/styleTokens';
import { SHORT_FORM_PLATFORMS, CANONICAL_STAGES, labelFor, defaultStageConfigForType, fetchDefaultAssigneeRows } from '../lib/kanbanStages';

// One shared list + a shared "Up Next" bucket above it. The old category
// sections live on as multi-select tags (idea_tags table, custom tags allowed).
const BUCKETS = ['up_next', 'list'];

// The four seeded tags still map to Projects types / the legacy `category`
// column (kept in sync for IdeasMobile, which is still sectioned). Custom
// tags map to neither — sending those to Projects prompts for a type.
const TAG_LABEL_TO_PROJECT_TYPE = {
  'Mayday Videos': 'mayday_video',
  'Trevor May Baseball Videos': 'tm_baseball_video',
  'Short Form Only': 'short_form',
  'Podcast Only': 'podcast',
};
const TAG_LABEL_TO_CATEGORY = {
  'Mayday Videos': 'mayday_videos',
  'Trevor May Baseball Videos': 'tm_baseball_videos',
  'Short Form Only': 'short_form_only',
  'Podcast Only': 'podcast_only',
};
const PROJECT_TYPE_OPTIONS = [
  { value: 'mayday_video', label: 'Mayday Video' },
  { value: 'tm_baseball_video', label: 'TM Baseball Video' },
  { value: 'short_form', label: 'Short Form' },
  { value: 'podcast', label: 'Podcast' },
];

// Who the Film Queue writer/editor pickers offer: every active staff member.
const STAFF_PICKER_ROLES = ['admin', 'director', 'director_creative', 'director_comms', 'member'];

const TAG_COLOR_CHOICES = ['#f87171', '#fb923c', '#fbbf24', '#34d399', '#22d3ee', '#8fb4d8', '#93c5fd', '#c084fc', '#f9a8d4'];

const IDEA_FIELDS = 'id, text, checked, position, category, bucket, tag_ids, context, potential_titles, project_id, created_by, created_at, updated_at, creator:profiles!created_by(full_name)';

// Ratings: admins + directors only — RLS on idea_ratings enforces the same
// set server-side, so other roles never receive rating rows at all.
const RATER_ROLES = ['admin', 'director', 'director_creative', 'director_comms'];
const RATING_COLORS = { 1: '#ef4444', 2: '#f97316', 3: '#facc15', 4: '#86efac', 5: '#22c55e' };
const MAX_TITLES = 5;

// Stable per-user name color, hashed from the profile id so desktop and
// mobile agree without storing anything.
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

// `embedded` renders the board inside the Projects page's Ideas view: the page
// chrome (padding, title, subtitle) belongs to Projects there, but the Select /
// Add / Add to Projects actions still ride along with the board.
export default function Ideas({ embedded = false }) {
  const { profile } = useAuth();
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [sending, setSending] = useState(false);
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y, id, bucket }
  const [showAddModal, setShowAddModal] = useState(false);
  const [projectModal, setProjectModal] = useState(null); // idea getting a project
  const [typePicker, setTypePicker] = useState(null); // { items, choices: { ideaId: type } }
  const [filmQueuePicker, setFilmQueuePicker] = useState(null); // { items, choices: { ideaId: { queue_type, writer_id, editor_id } } }
  const [staffProfiles, setStaffProfiles] = useState([]); // writer/editor picker options
  const [tagEditorId, setTagEditorId] = useState(null); // idea id with open tag popover
  const [tags, setTags] = useState([]);
  // View-only sort override, shared by both buckets. null = manual drag order.
  // Cycles asc → desc → off per column; drag-reorder is disabled while active.
  const [sort, setSort] = useState(null); // { key: 'date'|'tags'|'rating'|'addedBy', dir: 'asc'|'desc' }
  // Items keyed by bucket (up_next / list), each in position order.
  const [byBucket, setByBucket] = useState(() =>
    Object.fromEntries(BUCKETS.map((k) => [k, []]))
  );
  // Ratings (admins + directors; RLS hides rows from everyone else). Declared
  // up here because the sorted-view memo below reads ratingsByIdea.
  const canRate = RATER_ROLES.includes(profile?.role);
  const [ratingsByIdea, setRatingsByIdea] = useState({});

  const fetchAll = useCallback(async () => {
    const [ideasRes, tagsRes] = await Promise.all([
      supabase
        .from('write_ideas')
        .select(IDEA_FIELDS)
        // position is reindexed per-bucket, so add created_at as a deterministic
        // tiebreak — otherwise order can shuffle between reloads.
        .order('position', { ascending: true })
        .order('created_at', { ascending: true }),
      supabase
        .from('idea_tags')
        .select('id, label, color, position')
        .order('position', { ascending: true })
        .order('created_at', { ascending: true }),
    ]);
    if (ideasRes.error) {
      console.error('Error loading ideas:', ideasRes.error);
      return;
    }
    if (tagsRes.error) console.error('Error loading idea tags:', tagsRes.error);
    else setTags(tagsRes.data || []);
    const grouped = Object.fromEntries(BUCKETS.map((k) => [k, []]));
    for (const row of ideasRes.data || []) {
      const k = BUCKETS.includes(row.bucket) ? row.bucket : 'list';
      grouped[k].push(row);
    }
    setByBucket(grouped);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useVisibilityRefresh(fetchAll);

  const tagById = useCallback((id) => tags.find((t) => t.id === id), [tags]);

  function tagsForIdea(idea) {
    return (idea.tag_ids || []).map((id) => tagById(id)).filter(Boolean);
  }

  // Legacy `category` column stays synced to the first tag that maps to one,
  // so IdeasMobile (still sectioned) keeps showing every idea somewhere sane.
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

  async function persistOrder(bucket, items) {
    const results = await Promise.all(items.map((item) =>
      supabase.from('write_ideas')
        .update({ position: item.position, bucket })
        .eq('id', item.id)
    ));
    return results.find((r) => r.error)?.error || null;
  }

  // What each section actually renders: manual order, or the sort override.
  const displayedByBucket = useMemo(() => {
    if (!sort) return byBucket;
    const valueOf = (item) => {
      switch (sort.key) {
        case 'date': return new Date(item.created_at).getTime() || 0;
        case 'tags': {
          const labels = (item.tag_ids || [])
            .map((id) => tags.find((t) => t.id === id)?.label.toLowerCase())
            .filter(Boolean)
            .sort();
          return labels[0] ?? null;
        }
        case 'rating': {
          const ratings = ratingsByIdea[item.id] || [];
          return ratings.length ? ratings.reduce((s, r) => s + r.rating, 0) / ratings.length : null;
        }
        case 'addedBy': return (item.creator?.full_name || '').toLowerCase() || null;
        default: return null;
      }
    };
    const cmp = (a, b) => {
      const va = valueOf(a);
      const vb = valueOf(b);
      // Rows without a value (untagged, unrated, unknown creator) always sink.
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const c = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
      return sort.dir === 'asc' ? c : -c;
    };
    return Object.fromEntries(BUCKETS.map((k) => [k, [...(byBucket[k] || [])].sort(cmp)]));
  }, [byBucket, sort, ratingsByIdea, tags]);

  async function handleDragEnd(result) {
    if (!result.destination) return;
    const srcKey = result.source.droppableId;
    const dstKey = result.destination.droppableId;
    if (!BUCKETS.includes(srcKey) || !BUCKETS.includes(dstKey)) return;
    if (srcKey === dstKey && result.source.index === result.destination.index) return;

    // Indices are into what's on screen (possibly sorted). The item occupying
    // the drop slot anchors where the moved idea lands in the underlying
    // manual order, so dragging works the same with or without a sort active.
    const moved = (displayedByBucket[srcKey] || [])[result.source.index];
    if (!moved) return;
    const dstDisplayed = [...(displayedByBucket[dstKey] || [])];
    if (srcKey === dstKey) dstDisplayed.splice(result.source.index, 1);
    const anchor = dstDisplayed[result.destination.index] || null;

    const nextSrc = byBucket[srcKey].filter((i) => i.id !== moved.id);
    const dstBase = srcKey === dstKey ? nextSrc : [...byBucket[dstKey]];
    const insertAt = anchor ? dstBase.findIndex((i) => i.id === anchor.id) : dstBase.length;
    const nextDst = [...dstBase];
    nextDst.splice(insertAt < 0 ? nextDst.length : insertAt, 0, { ...moved, bucket: dstKey });

    const reindexedSrc = nextSrc.map((item, idx) => ({ ...item, position: idx }));
    const reindexedDst = nextDst.map((item, idx) => ({ ...item, position: idx, bucket: dstKey }));

    setByBucket((prev) => ({
      ...prev,
      ...(srcKey !== dstKey ? { [srcKey]: reindexedSrc } : {}),
      [dstKey]: reindexedDst,
    }));

    const errors = [
      srcKey !== dstKey ? await persistOrder(srcKey, reindexedSrc) : null,
      await persistOrder(dstKey, reindexedDst),
    ].filter(Boolean);
    if (errors.length) {
      console.error('Error reordering ideas:', errors[0]);
      fetchAll();
    }
  }

  // Context-menu fallback for moving between buckets without dragging.
  async function moveToBucket(id, dstKey) {
    const srcKey = dstKey === 'list' ? 'up_next' : 'list';
    const idea = (byBucket[srcKey] || []).find((i) => i.id === id);
    if (!idea) return;
    const nextSrc = byBucket[srcKey].filter((i) => i.id !== id).map((item, idx) => ({ ...item, position: idx }));
    const nextDst = [...byBucket[dstKey], { ...idea, bucket: dstKey }].map((item, idx) => ({ ...item, position: idx }));
    setByBucket((prev) => ({ ...prev, [srcKey]: nextSrc, [dstKey]: nextDst }));
    const errors = [await persistOrder(srcKey, nextSrc), await persistOrder(dstKey, nextDst)].filter(Boolean);
    if (errors.length) {
      console.error('Error moving idea:', errors[0]);
      fetchAll();
    }
  }

  async function addItem({ text, context, tagIds }) {
    const trimmed = (text || '').trim();
    if (!trimmed) return false;
    if (!profile?.id) {
      alert('Cannot add: not signed in.');
      return false;
    }
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
    if (error) {
      console.error('Error adding idea:', error);
      alert(`Could not save idea: ${error.message || 'unknown error'}`);
      return false;
    }
    setByBucket((prev) => ({ ...prev, list: [...(prev.list || []), data] }));
    return true;
  }

  function patchIdea(id, patch) {
    setByBucket((prev) => {
      const next = {};
      for (const k of BUCKETS) next[k] = (prev[k] || []).map((i) => (i.id === id ? { ...i, ...patch } : i));
      return next;
    });
  }

  function findIdea(id) {
    for (const k of BUCKETS) {
      const found = (byBucket[k] || []).find((i) => i.id === id);
      if (found) return found;
    }
    return null;
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
    if (error) {
      console.error('Error toggling idea:', error);
      fetchAll();
    }
  }

  async function deleteItem(id, bucket) {
    const previous = byBucket[bucket];
    setByBucket((prev) => ({
      ...prev,
      [bucket]: prev[bucket].filter((i) => i.id !== id),
    }));
    const { error } = await supabase.from('write_ideas').delete().eq('id', id);
    if (error) {
      console.error('Error deleting idea:', error);
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
    if (error) {
      console.error('Error saving idea edit:', error);
      fetchAll();
    }
  }

  async function saveContext(id, newContext) {
    const value = (newContext || '').trim() || null;
    patchIdea(id, { context: value });
    const { error } = await supabase
      .from('write_ideas')
      .update({ context: value, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      console.error('Error saving idea context:', error);
      fetchAll();
    }
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
    if (error) {
      console.error('Error saving idea tags:', error);
      fetchAll();
    }
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
      console.error('Error creating tag:', error);
      alert(`Could not create tag: ${error.message || 'unknown error'}`);
      return null;
    }
    setTags((prev) => [...prev, data]);
    return data;
  }

  // ── Potential titles (max 5, stored on the idea row) ──
  async function saveTitles(id, titles) {
    const clean = (titles || []).map((t) => String(t).trim()).filter(Boolean).slice(0, MAX_TITLES);
    patchIdea(id, { potential_titles: clean });
    const { error } = await supabase
      .from('write_ideas')
      .update({ potential_titles: clean, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      console.error('Error saving titles:', error);
      fetchAll();
    }
  }

  // ── Ratings fetch/write (state declared above the sorted-view memo) ──
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

  function requestSendToProjects() {
    const items = BUCKETS.flatMap((k) => byBucket[k] || []).filter((i) => selectedIds.has(i.id));
    if (items.length === 0 || sending) return;
    // Ideas whose tags map to exactly one project type go straight through;
    // zero or 2+ mapped types needs a human pick.
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
    const rows = items.map((i) => {
      // Potential titles travel with the idea into the project's notes.
      const titles = (Array.isArray(i.potential_titles) ? i.potential_titles : []).filter(Boolean);
      const titleNote = titles.length ? `Potential titles:\n- ${titles.join('\n- ')}` : null;
      return {
        name: i.text,
        type: typeFor(i) || 'mayday_video',
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
    const ids = new Set(items.map((i) => i.id));
    const { error: delError } = await supabase.from('write_ideas').delete().in('id', [...ids]);
    if (delError) console.error('Error removing exported ideas:', delError);
    setByBucket((prev) => {
      const next = {};
      for (const k of BUCKETS) next[k] = (prev[k] || []).filter((i) => !ids.has(i.id));
      return next;
    });
    setSending(false);
    setTypePicker(null);
    exitSelectMode();
  }

  // ── Add to Film Queue ──
  // Queue types an idea's tags map to (podcast deliberately maps to nothing).
  function queueTypesFor(idea) {
    const types = [];
    for (const t of tagsForIdea(idea)) {
      const type = IDEA_TAG_TO_QUEUE_TYPE[t.label];
      if (type && !types.includes(type)) types.push(type);
    }
    return types;
  }

  // The details modal always opens — it captures the writer and editor
  // assignments per idea, not just the type.
  function requestSendToFilmQueue() {
    const items = BUCKETS.flatMap((k) => byBucket[k] || []).filter((i) => selectedIds.has(i.id));
    if (items.length === 0 || sending) return;
    setFilmQueuePicker({
      items,
      choices: Object.fromEntries(items.map((i) => [i.id, {
        queue_type: queueTypesFor(i)[0] || 'mayday',
        writer_id: '',
        editor_id: '',
      }])),
    });
  }

  // The edge function creates the beat sheet + queue item + writer task and
  // deletes the idea — no project card. Non-admins can't insert those rows
  // directly (RLS), so this must go through film-queue.
  async function sendToFilmQueue() {
    if (!filmQueuePicker || sending) return;
    setSending(true);
    try {
      const payload = filmQueuePicker.items.map((i) => ({
        idea_id: i.id,
        ...filmQueuePicker.choices[i.id],
      }));
      const result = await callEdgeFn('film-queue', { action: 'enqueue_ideas', items: payload });
      const createdIds = new Set((result.created || []).map((c) => c.idea_id));
      if (createdIds.size > 0) {
        setByBucket((prev) => {
          const next = {};
          for (const k of BUCKETS) next[k] = (prev[k] || []).filter((i) => !createdIds.has(i.id));
          return next;
        });
      }
      if (result.errors?.length) {
        alert(`Some ideas could not be queued:\n${result.errors.map((e) => e.error).join('\n')}`);
      } else {
        setFilmQueuePicker(null);
        exitSelectMode();
      }
    } catch (err) {
      alert(`Could not add to Film Queue: ${err.message}`);
    }
    setSending(false);
  }

  // Staff list for the writer/editor pickers, loaded when the modal first opens.
  useEffect(() => {
    if (!filmQueuePicker || staffProfiles.length > 0) return undefined;
    let alive = true;
    (async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email, role')
        .in('role', STAFF_PICKER_ROLES)
        .is('deactivated_at', null)
        .order('full_name', { ascending: true, nullsFirst: false });
      if (error) { console.error('Error loading staff:', error); return; }
      if (alive) setStaffProfiles(data || []);
    })();
    return () => { alive = false; };
  }, [filmQueuePicker, staffProfiles.length]);

  // Ideas → Up Next → "Add Project": creates a real project card in the
  // operator-chosen start stage (created in Queue, then advanced through
  // card-move so that stage's assignees get their tasks). The idea stays on
  // the board, linked via project_id, and its button flips to "In Production".
  async function createProjectFromIdea(idea, { name, type, platforms, deadline, stage, assigneeId }) {
    const titles = (Array.isArray(idea.potential_titles) ? idea.potential_titles : []).filter(Boolean);
    const titleNote = titles.length ? `Potential titles:\n- ${titles.join('\n- ')}` : null;
    // The chosen start stage must not be skipped by the type's default stage
    // config (podcast / short_form skip research by default).
    const cfg = defaultStageConfigForType(type);
    delete cfg[stage];
    const { data: created, error } = await supabase.from('projects').insert({
      name,
      type,
      short_form_platforms: type === 'short_form' ? platforms : [],
      status: 'queue',
      start_column: stage,
      deadline: deadline || null,
      notes: [titleNote, idea.context].filter(Boolean).join('\n\n') || null,
      stage_config: cfg,
      created_by: profile?.id || null,
    }).select('id').single();
    if (error) throw new Error(error.message);
    // Seed default assignees + a queue-stage row for the creator so a
    // non-admin's card-move passes its current-stage-assignee check. A chosen
    // assignee replaces the type defaults for the start stage only.
    let seedRows = await fetchDefaultAssigneeRows(supabase, type, created.id);
    if (assigneeId) {
      seedRows = seedRows.filter((r) => r.stage !== stage);
      seedRows.push({ project_id: created.id, stage, user_id: assigneeId });
    }
    if (profile?.id && !seedRows.some((r) => r.stage === 'queue' && r.user_id === profile.id)) {
      seedRows.push({ project_id: created.id, stage: 'queue', user_id: profile.id });
    }
    const { error: aErr } = await supabase.from('project_stage_assignments').insert(seedRows);
    if (aErr) console.error('Assignee seed failed:', aErr);
    if (stage !== 'queue') {
      await callEdgeFn('card-move', { project_id: created.id, target_stage: stage });
    }
    const { error: linkErr } = await supabase.from('write_ideas')
      .update({ project_id: created.id })
      .eq('id', idea.id);
    if (linkErr) console.error('Idea link failed:', linkErr);
    setByBucket((prev) => {
      const next = {};
      for (const k of BUCKETS) {
        next[k] = (prev[k] || []).map((i) => (i.id === idea.id ? { ...i, project_id: created.id } : i));
      }
      return next;
    });
  }

  function cycleSort(key) {
    setSort((prev) => {
      if (prev?.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return null;
    });
  }

  const sectionProps = {
    tags,
    tagsForIdea,
    sort,
    onSort: cycleSort,
    onToggle: toggleItem,
    onItemContextMenu: (e, item) => {
      e.preventDefault();
      setCtxMenu({ x: e.clientX, y: e.clientY, id: item.id, bucket: item.bucket });
    },
    onSaveEdit: saveEdit,
    onSaveContext: saveContext,
    onSaveTitles: saveTitles,
    onSaveTags: saveTags,
    onCreateTag: createTag,
    tagEditorId,
    setTagEditorId,
    canRate,
    currentUserId: profile?.id,
    ratingsByIdea,
    onRate: rateIdea,
    selectMode,
    selectedIds,
    onToggleSelect: toggleSelect,
    onAddProject: (item) => setProjectModal(item),
  };

  // Rendered inline in the Ideas section header, next to the title.
  const listActions = (
    <div style={styles.headerActions}>
      {selectMode ? (
        <>
          <button
            onClick={requestSendToProjects}
            disabled={selectedIds.size === 0 || sending}
            style={{
              ...styles.addToProjectsBtn,
              opacity: selectedIds.size === 0 || sending ? 0.4 : 1,
              cursor: selectedIds.size === 0 || sending ? 'default' : 'pointer',
            }}
          >
            {sending ? 'Adding…' : `Add to Projects (${selectedIds.size})`}
          </button>
          <button
            onClick={requestSendToFilmQueue}
            disabled={selectedIds.size === 0 || sending}
            style={{
              ...styles.addToFilmQueueBtn,
              opacity: selectedIds.size === 0 || sending ? 0.4 : 1,
              cursor: selectedIds.size === 0 || sending ? 'default' : 'pointer',
            }}
          >
            {`Add to Film Queue (${selectedIds.size})`}
          </button>
          <button onClick={exitSelectMode} style={styles.selectCancelBtn}>Cancel</button>
        </>
      ) : (
        <>
          <button onClick={() => setSelectMode(true)} style={styles.selectBtn}>Select</button>
          <button onClick={() => setShowAddModal(true)} style={styles.addIdeaBtn}>+ Add Idea</button>
        </>
      )}
    </div>
  );

  return (
    <div style={embedded ? styles.embeddedPage : styles.page}>
      {!embedded && (
        <header style={styles.header}>
          <div>
            <h1 style={styles.pageTitle}>Ideas</h1>
            <p style={styles.pageSubtitle}>
              One shared list. Tag ideas, and drag the next ones up into Up Next.
            </p>
          </div>
        </header>
      )}

      <DragDropContext onDragEnd={handleDragEnd}>
        <div style={styles.sectionsWrap}>
          <BucketSection
            bucket="up_next"
            title="Up Next"
            titleColor={colors.accentFg}
            emptyHint="Drag ideas up here to queue what's next."
            items={displayedByBucket.up_next || []}
            {...sectionProps}
          />
          <BucketSection
            bucket="list"
            title="Ideas"
            titleColor="#e2e8f0"
            emptyHint="No ideas yet — hit + Add Idea."
            items={displayedByBucket.list || []}
            actions={listActions}
            {...sectionProps}
          />
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
              style={styles.ctxItem}
              onClick={() => {
                moveToBucket(ctxMenu.id, ctxMenu.bucket === 'up_next' ? 'list' : 'up_next');
                setCtxMenu(null);
              }}
            >
              {ctxMenu.bucket === 'up_next' ? 'Move to Ideas' : 'Move to Up Next'}
            </button>
            <button
              style={{ ...styles.ctxItem, color: '#f87171' }}
              onClick={() => { deleteItem(ctxMenu.id, ctxMenu.bucket); setCtxMenu(null); }}
            >
              Delete
            </button>
          </div>
        </>
      )}

      {projectModal && (
        <IdeaProjectModal
          idea={projectModal}
          defaultType={projectTypesFor(projectModal)[0] || 'mayday_video'}
          onCreate={createProjectFromIdea}
          onClose={() => setProjectModal(null)}
        />
      )}
      {showAddModal && (
        <AddIdeaModal
          tags={tags}
          onCreateTag={createTag}
          onSubmit={async (draft) => {
            const ok = await addItem(draft);
            if (ok) setShowAddModal(false);
          }}
          onClose={() => setShowAddModal(false)}
        />
      )}

      {filmQueuePicker && (
        <FilmQueueModal
          picker={filmQueuePicker}
          tagsForIdea={tagsForIdea}
          staffProfiles={staffProfiles}
          sending={sending}
          onChange={(ideaId, patch) => setFilmQueuePicker((prev) => ({
            ...prev,
            choices: { ...prev.choices, [ideaId]: { ...prev.choices[ideaId], ...patch } },
          }))}
          onConfirm={sendToFilmQueue}
          onClose={() => setFilmQueuePicker(null)}
        />
      )}

      {typePicker && (
        <TypePickerModal
          picker={typePicker}
          tagsForIdea={tagsForIdea}
          sending={sending}
          onChoose={(ideaId, type) => setTypePicker((prev) => ({
            ...prev,
            choices: { ...prev.choices, [ideaId]: type },
          }))}
          onConfirm={() => {
            const { items, choices } = typePicker;
            sendToProjects(items, (i) => choices[i.id] || projectTypesFor(i)[0]);
          }}
          onClose={() => setTypePicker(null)}
        />
      )}
    </div>
  );
}

function SortableTh({ label, k, sort, onSort }) {
  const active = sort?.key === k;
  return (
    <button
      onClick={() => onSort(k)}
      title="Sort — click again to flip, a third time to clear"
      style={{ ...styles.th, ...styles.thSortBtn, ...(active ? styles.thSortActive : {}) }}
    >
      {label}{active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
    </button>
  );
}

// ── Tag picker (shared by row popover + add modal) ──
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

function AddIdeaModal({ tags, onCreateTag, onSubmit, onClose }) {
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
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h3 style={styles.modalTitle}>Add Idea</h3>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') onClose();
          }}
          placeholder="What's the idea?"
          style={styles.input}
          autoFocus
        />
        <textarea
          value={context}
          onChange={(e) => setContext(e.target.value)}
          placeholder="Description (optional) — notes, angles, references…"
          style={{ ...styles.contextTextarea, marginTop: '10px' }}
          rows={3}
        />
        <div style={styles.modalSectionLabel}>Tags</div>
        <TagPicker tags={tags} selectedIds={tagIds} onToggleTag={toggleTag} onCreateTag={onCreateTag} />
        <div style={styles.modalBtnRow}>
          <button
            onClick={commit}
            disabled={!text.trim() || saving}
            style={{ ...styles.submitBtn, flex: 'none', padding: '8px 20px', opacity: text.trim() && !saving ? 1 : 0.4 }}
          >
            {saving ? 'Adding…' : 'Add Idea'}
          </button>
          <button onClick={onClose} style={{ ...styles.cancelBtn, flex: 'none', padding: '8px 16px' }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// "Add Project" from an Up Next idea. Creates the card straight into the
// Research stage; the idea stays on the board flagged In Production.
function IdeaProjectModal({ idea, defaultType, onCreate, onClose }) {
  const [name, setName] = useState(idea.text || '');
  const [type, setType] = useState(defaultType);
  const [platforms, setPlatforms] = useState([]);
  const [deadline, setDeadline] = useState('');
  const [stage, setStage] = useState('research');
  const [assigneeId, setAssigneeId] = useState('');
  const [staffList, setStaffList] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from('profiles')
      .select('id, full_name, nickname')
      .is('deactivated_at', null)
      .in('role', ['admin', 'director', 'member', 'contractor'])
      .order('full_name')
      .then(({ data, error }) => { if (!error) setStaffList(data || []); });
  }, []);

  async function commit() {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      await onCreate(idea, { name: name.trim(), type, platforms, deadline, stage, assigneeId: assigneeId || null });
      onClose();
    } catch (err) {
      alert(`Could not create project: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h3 style={styles.modalTitle}>Add Project</h3>
        <p style={styles.modalHint}>
          Creates a project card from this idea in the stage you pick, assigned
          to the person you pick (or the type's default assignees).
        </p>
        <div style={styles.modalSectionLabel}>Name</div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
          style={styles.input}
          autoFocus
        />
        <div style={styles.modalSectionLabel}>Type</div>
        <select value={type} onChange={(e) => setType(e.target.value)} style={{ ...styles.typeSelect, width: '100%' }}>
          {PROJECT_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {type === 'short_form' && (
          <>
            <div style={styles.modalSectionLabel}>Platforms</div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {SHORT_FORM_PLATFORMS.map((p) => {
                const on = platforms.includes(p.value);
                return (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setPlatforms(on ? platforms.filter((x) => x !== p.value) : [...platforms, p.value])}
                    style={{
                      padding: '3px 10px', borderRadius: 999,
                      border: `1px solid ${on ? colors.accentBorder : 'rgba(255,255,255,0.12)'}`,
                      background: on ? colors.accentSoft : 'transparent',
                      color: on ? colors.accentFg : 'rgba(255,255,255,0.45)',
                      fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </>
        )}
        <div style={styles.modalSectionLabel}>Start Stage</div>
        <select value={stage} onChange={(e) => setStage(e.target.value)} style={{ ...styles.typeSelect, width: '100%' }}>
          {CANONICAL_STAGES.filter((st) => st !== 'publish').map((st) => (
            <option key={st} value={st}>{labelFor(type, st)}</option>
          ))}
        </select>
        <div style={styles.modalSectionLabel}>Assignee</div>
        <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} style={{ ...styles.typeSelect, width: '100%' }}>
          <option value="">Type default assignees</option>
          {staffList.map((m) => (
            <option key={m.id} value={m.id}>{m.nickname || m.full_name}</option>
          ))}
        </select>
        <div style={styles.modalSectionLabel}>Post Date (optional)</div>
        <input
          type="date"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
          style={styles.input}
        />
        <div style={styles.modalBtnRow}>
          <button
            onClick={commit}
            disabled={!name.trim() || saving}
            style={{ ...styles.submitBtn, flex: 'none', padding: '8px 20px', opacity: name.trim() && !saving ? 1 : 0.4 }}
          >
            {saving ? 'Creating…' : 'Create Project'}
          </button>
          <button onClick={onClose} style={{ ...styles.cancelBtn, flex: 'none', padding: '8px 16px' }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function TypePickerModal({ picker, tagsForIdea, sending, onChoose, onConfirm, onClose }) {
  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h3 style={styles.modalTitle}>Pick project types</h3>
        <p style={styles.modalHint}>
          These ideas don't map cleanly to a single project type from their tags — choose one for each.
        </p>
        <div style={styles.typePickList}>
          {picker.ambiguous.map((i) => (
            <div key={i.id} style={styles.typePickRow}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={styles.typePickIdea}>{i.text}</div>
                <div style={styles.typePickTags}>
                  {tagsForIdea(i).map((t) => (
                    <span key={t.id} style={{ ...styles.tagChip, background: `${t.color}26`, color: t.color, borderColor: `${t.color}55` }}>
                      {t.label}
                    </span>
                  ))}
                </div>
              </div>
              <select
                value={picker.choices[i.id]}
                onChange={(e) => onChoose(i.id, e.target.value)}
                style={styles.typeSelect}
              >
                {PROJECT_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
        <div style={styles.modalBtnRow}>
          <button
            onClick={onConfirm}
            disabled={sending}
            style={{ ...styles.submitBtn, flex: 'none', padding: '8px 20px', opacity: sending ? 0.4 : 1 }}
          >
            {sending ? 'Adding…' : `Add to Projects (${picker.items.length})`}
          </button>
          <button onClick={onClose} style={{ ...styles.cancelBtn, flex: 'none', padding: '8px 16px' }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// Details modal for Add to Film Queue: per idea, the type plus the writer and
// editor assignments (both required — the writer gets the beat sheet task
// immediately, the editor gets the edit task after filming).
function FilmQueueModal({ picker, tagsForIdea, staffProfiles, sending, onChange, onConfirm, onClose }) {
  const allAssigned = picker.items.every((i) => {
    const c = picker.choices[i.id] || {};
    return c.queue_type && c.writer_id && c.editor_id;
  });

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={{ ...styles.modal, ...styles.modalWide }} onClick={(e) => e.stopPropagation()}>
        <h3 style={styles.modalTitle}>Add to Film Queue</h3>
        <p style={styles.modalHint}>
          Each idea becomes a beat sheet in the film queue — no project card. The writer
          gets the beat sheet task right away; the editor gets the edit task after filming.
        </p>
        <div style={styles.typePickList}>
          {picker.items.map((i) => {
            const c = picker.choices[i.id] || {};
            return (
              <div key={i.id} style={styles.fqPickRow}>
                <div style={{ minWidth: 0 }}>
                  <div style={styles.typePickIdea}>{i.text}</div>
                  <div style={styles.typePickTags}>
                    {tagsForIdea(i).map((t) => (
                      <span key={t.id} style={{ ...styles.tagChip, background: `${t.color}26`, color: t.color, borderColor: `${t.color}55` }}>
                        {t.label}
                      </span>
                    ))}
                  </div>
                </div>
                <div style={styles.fqSelectRow}>
                  <label style={styles.fqSelectLabel}>
                    Type
                    <select
                      value={c.queue_type || 'mayday'}
                      onChange={(e) => onChange(i.id, { queue_type: e.target.value })}
                      style={styles.typeSelect}
                    >
                      {QUEUE_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </label>
                  <label style={styles.fqSelectLabel}>
                    Writer
                    <select
                      value={c.writer_id || ''}
                      onChange={(e) => onChange(i.id, { writer_id: e.target.value })}
                      style={styles.typeSelect}
                    >
                      <option value="">— Pick —</option>
                      {staffProfiles.map((p) => (
                        <option key={p.id} value={p.id}>{p.full_name || p.email}</option>
                      ))}
                    </select>
                  </label>
                  <label style={styles.fqSelectLabel}>
                    Editor
                    <select
                      value={c.editor_id || ''}
                      onChange={(e) => onChange(i.id, { editor_id: e.target.value })}
                      style={styles.typeSelect}
                    >
                      <option value="">— Pick —</option>
                      {staffProfiles.map((p) => (
                        <option key={p.id} value={p.id}>{p.full_name || p.email}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            );
          })}
        </div>
        <div style={styles.modalBtnRow}>
          <button
            onClick={onConfirm}
            disabled={sending || !allAssigned}
            title={allAssigned ? undefined : 'Pick a writer and an editor for every idea'}
            style={{ ...styles.submitBtn, flex: 'none', padding: '8px 20px', opacity: sending || !allAssigned ? 0.4 : 1 }}
          >
            {sending ? 'Adding…' : `Add to Film Queue (${picker.items.length})`}
          </button>
          <button onClick={onClose} style={{ ...styles.cancelBtn, flex: 'none', padding: '8px 16px' }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function BucketSection({ bucket, title, titleColor, emptyHint, items, actions, tags, tagsForIdea, sort, onSort, onToggle, onItemContextMenu, onSaveEdit, onSaveContext, onSaveTitles, onSaveTags, onCreateTag, tagEditorId, setTagEditorId, canRate, currentUserId, ratingsByIdea, onRate, selectMode, selectedIds, onToggleSelect, onAddProject }) {
  const [editingId, setEditingId] = useState(null);
  const [editingText, setEditingText] = useState('');
  const [contextEditingId, setContextEditingId] = useState(null);
  const [contextDraft, setContextDraft] = useState('');
  const [titleAddingId, setTitleAddingId] = useState(null);
  const [titleDraft, setTitleDraft] = useState('');

  // Grid template gains a Rating column only for rater roles, and Up Next
  // carries a trailing Project column ("Add Project" / "In Production").
  const baseGrid = canRate ? styles.rowGridRate : styles.rowGrid;
  const hasProjectCol = bucket === 'up_next';
  const grid = hasProjectCol
    ? { ...baseGrid, gridTemplateColumns: `${baseGrid.gridTemplateColumns} 108px` }
    : baseGrid;

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
    <section style={bucket === 'up_next' ? { ...styles.section, ...styles.upNextSection } : styles.section}>
      <div style={styles.sectionHeader}>
        <span style={{ ...styles.sectionTitle, color: titleColor }}>{title}</span>
        <span style={styles.sectionCount}>{items.length}</span>
        <div style={{ flex: 1 }} />
        {actions}
      </div>

      <div style={{ ...grid, ...styles.theadRow }}>
        <span />
        <SortableTh label="Date Added" k="date" sort={sort} onSort={onSort} />
        <span style={styles.th}>Idea</span>
        <SortableTh label="Tags" k="tags" sort={sort} onSort={onSort} />
        <span style={styles.th}>Description</span>
        <span style={styles.th}>Potential Titles</span>
        {canRate && <SortableTh label="Rating" k="rating" sort={sort} onSort={onSort} />}
        <SortableTh label="Added by" k="addedBy" sort={sort} onSort={onSort} />
        {hasProjectCol && <span style={styles.th}>Project</span>}
      </div>

      <Droppable droppableId={bucket}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            style={snapshot.isDraggingOver ? styles.listDraggingOver : undefined}
          >
            {items.map((item, index) => {
              const titles = Array.isArray(item.potential_titles) ? item.potential_titles : [];
              const itemTags = tagsForIdea(item);
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
                        <span style={styles.dateAdded} title={item.created_at ? new Date(item.created_at).toLocaleString() : undefined}>
                          {fmtDateAdded(item.created_at)}
                        </span>
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

                      <div style={{ ...styles.cell, ...styles.tagsCell }}>
                        {itemTags.map((t) => (
                          <span
                            key={t.id}
                            style={{ ...styles.tagChip, background: `${t.color}26`, color: t.color, borderColor: `${t.color}55` }}
                          >
                            {t.label}
                          </span>
                        ))}
                        {!selectMode && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setTagEditorId(tagEditorId === item.id ? null : item.id); }}
                            style={styles.tagEditBtn}
                            title="Edit tags"
                          >+</button>
                        )}
                        {tagEditorId === item.id && (
                          <>
                            <div style={styles.ctxOverlay} onClick={(e) => { e.stopPropagation(); setTagEditorId(null); }} />
                            <div style={styles.tagPopover} onClick={(e) => e.stopPropagation()}>
                              <TagPicker
                                tags={tags}
                                selectedIds={item.tag_ids || []}
                                onToggleTag={(tagId) => {
                                  const current = item.tag_ids || [];
                                  onSaveTags(
                                    item.id,
                                    current.includes(tagId) ? current.filter((t) => t !== tagId) : [...current, tagId],
                                  );
                                }}
                                onCreateTag={onCreateTag}
                              />
                            </div>
                          </>
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

                      {hasProjectCol && (
                        <div style={styles.cell}>
                          {item.project_id ? (
                            <span style={styles.inProductionTag} title="A project card already exists for this idea.">
                              In Production
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); onAddProject(item); }}
                              disabled={selectMode}
                              style={{ ...styles.addProjectBtn, opacity: selectMode ? 0.4 : 1 }}
                            >
                              + Add Project
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </Draggable>
              );
            })}
            {provided.placeholder}
            {items.length === 0 && (
              <p style={styles.emptyText}>{emptyHint}</p>
            )}
          </div>
        )}
      </Droppable>
    </section>
  );
}

const styles = {
  page: { padding: '36px 40px 64px', maxWidth: '1500px', margin: '0 auto', minHeight: '100vh' },
  // Embedded in Projects: that page already supplies the padding and max-width.
  embeddedPage: {},
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
  addIdeaBtn: {
    padding: '8px 16px',
    background: colors.accent,
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  addToProjectsBtn: {
    padding: '8px 16px',
    background: colors.accent,
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '13px',
    fontWeight: 600,
    fontFamily: 'inherit',
  },
  addToFilmQueueBtn: {
    padding: '8px 16px',
    background: colors.info.bg,
    border: `1px solid ${colors.info.border}`,
    borderRadius: '8px',
    color: colors.info.fgSoft,
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
  input: {
    width: '100%',
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
    background: colors.accent,
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
  listDraggingOver: { background: colors.accentA06 },
  itemSelectable: { cursor: 'pointer', borderRadius: '6px' },
  itemSelected: { background: colors.accentA12 },
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
    background: colors.accent,
    border: '1.5px solid #5b8fc7',
  },
  creatorName: { fontSize: '11px', color: 'rgba(255,255,255,0.3)' },
  dateAdded: { fontSize: '11px', color: 'rgba(255,255,255,0.35)', whiteSpace: 'nowrap' },
  // ── Table layout (Up Next + Ideas buckets) ──
  sectionsWrap: { display: 'flex', flexDirection: 'column', gap: '28px' },
  section: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: '12px',
    padding: '14px 16px 16px',
  },
  upNextSection: {
    background: colors.accentA06,
    border: '1px solid rgba(91, 143, 199,0.25)',
  },
  sectionHeader: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' },
  sectionTitle: { fontSize: '15px', fontWeight: 700, color: '#e2e8f0' },
  sectionCount: {
    fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.4)',
    background: 'rgba(255,255,255,0.06)', padding: '2px 8px', borderRadius: '10px',
  },
  rowGrid: {
    display: 'grid',
    gridTemplateColumns: '52px 78px minmax(150px, 1.1fr) minmax(130px, 0.8fr) minmax(150px, 1fr) minmax(130px, 0.9fr) 96px',
    gap: '12px',
    alignItems: 'start',
  },
  rowGridRate: {
    display: 'grid',
    gridTemplateColumns: '52px 78px minmax(150px, 1.1fr) minmax(130px, 0.8fr) minmax(150px, 1fr) minmax(130px, 0.9fr) 128px 96px',
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
  thSortBtn: {
    background: 'none', border: 'none', padding: 0, textAlign: 'left',
    cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
  },
  thSortActive: { color: colors.accentFg },
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
  // ── Tags ──
  tagsCell: { display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center', position: 'relative' },
  tagChip: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: '10px',
    border: '1px solid',
    fontSize: '11px',
    fontWeight: 600,
    whiteSpace: 'nowrap',
  },
  tagEditBtn: {
    background: 'none', border: '1px dashed rgba(255,255,255,0.2)', borderRadius: '10px',
    color: 'rgba(255,255,255,0.4)', fontSize: '11px', padding: '1px 7px',
    cursor: 'pointer', fontFamily: 'inherit', lineHeight: '16px',
  },
  tagPopover: {
    position: 'absolute',
    top: 'calc(100% + 6px)',
    left: 0,
    zIndex: 1000,
    background: '#1a1a28',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '10px',
    padding: '10px',
    width: '240px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
  },
  tagPickerList: { display: 'flex', flexWrap: 'wrap', gap: '5px' },
  tagPickerChip: { cursor: 'pointer', fontFamily: 'inherit', background: 'rgba(255,255,255,0.04)' },
  tagCreateRow: { display: 'flex', gap: '6px', marginTop: '8px' },
  tagCreateInput: {
    flex: 1,
    minWidth: 0,
    padding: '5px 8px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '12px',
    fontFamily: 'inherit',
    outline: 'none',
  },
  tagCreateBtn: {
    padding: '5px 10px',
    background: colors.accent,
    border: 'none',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  tagColorRow: { display: 'flex', gap: '5px', marginTop: '8px', flexWrap: 'wrap' },
  tagColorSwatch: {
    width: '18px', height: '18px', borderRadius: '50%', border: 'none',
    cursor: 'pointer', padding: 0,
  },
  // ── Modals ──
  modalOverlay: {
    position: 'fixed', inset: 0, zIndex: 1100,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '24px',
  },
  modal: {
    background: '#14141f',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '14px',
    padding: '20px',
    width: '100%',
    maxWidth: '440px',
    maxHeight: '80vh',
    overflowY: 'auto',
    boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
  },
  modalTitle: { fontSize: '16px', fontWeight: 700, color: '#fff', margin: '0 0 14px 0' },
  modalHint: { fontSize: '12px', color: 'rgba(255,255,255,0.5)', margin: '-6px 0 12px 0', lineHeight: 1.5 },
  modalSectionLabel: {
    fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
    color: 'rgba(255,255,255,0.35)', margin: '14px 0 8px',
  },
  modalBtnRow: { display: 'flex', gap: '8px', marginTop: '18px', justifyContent: 'flex-end' },
  addProjectBtn: {
    padding: '3px 10px', borderRadius: '999px',
    border: `1px solid ${colors.accentBorder}`, background: colors.accentSoft,
    color: colors.accentFg, fontSize: '11px', fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
  },
  inProductionTag: {
    display: 'inline-block', padding: '3px 10px', borderRadius: '999px',
    border: '1px solid rgba(34,197,94,0.4)', background: 'rgba(34,197,94,0.12)',
    color: '#4ade80', fontSize: '11px', fontWeight: 600, whiteSpace: 'nowrap',
    cursor: 'default',
  },
  typePickList: { display: 'flex', flexDirection: 'column', gap: '10px' },
  modalWide: { maxWidth: '640px' },
  fqPickRow: {
    display: 'flex', flexDirection: 'column', gap: '10px',
    padding: '10px', background: colors.whiteA03,
    border: `1px solid ${colors.border}`, borderRadius: '10px',
  },
  fqSelectRow: { display: 'flex', gap: '10px', flexWrap: 'wrap' },
  fqSelectLabel: {
    display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minWidth: '140px',
    fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
    color: colors.textDim,
  },
  typePickRow: {
    display: 'flex', alignItems: 'center', gap: '12px',
    padding: '10px', background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.07)', borderRadius: '10px',
  },
  typePickIdea: { fontSize: '13px', color: '#e2e8f0', wordBreak: 'break-word' },
  typePickTags: { display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' },
  typeSelect: {
    padding: '6px 8px',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '8px',
    color: '#e2e8f0',
    fontSize: '12px',
    fontFamily: 'inherit',
    outline: 'none',
    flexShrink: 0,
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
    padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(91, 143, 199,0.35)',
    background: 'rgba(255,255,255,0.05)', color: '#e2e8f0', fontSize: '12px',
    fontFamily: 'inherit', outline: 'none',
  },
  titleAddBtn: {
    background: 'none', border: '1px dashed rgba(91, 143, 199,0.3)', borderRadius: 6,
    color: 'rgba(165,180,252,0.6)', fontSize: '11px', padding: '3px 8px',
    cursor: 'pointer', fontFamily: 'inherit', width: 'fit-content',
  },
  contextEditWrap: { padding: '4px 0 6px' },
  contextTextarea: {
    width: '100%',
    padding: '8px 10px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(91, 143, 199,0.4)',
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
    background: colors.accent,
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
    border: '1px solid rgba(91, 143, 199,0.5)',
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
    background: colors.bgHover,
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
