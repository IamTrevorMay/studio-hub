import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { callWorkflowFn } from '../lib/workflowApi';
import { fetchAllRows } from './analytics/utils';
import FindAssetsModal from '../components/FindAssetsModal';
import GDocsEditor from './editors/doc-editor/gdocs/GDocsEditor';
import usePersistedTab from '../hooks/usePersistedTab';
import { BEAT_SHEET_STATUSES, STATUS_BY_VALUE } from '../lib/filmQueue';
import { defaultStageConfigForType, fetchDefaultAssigneeRows } from '../lib/kanbanStages';
import { buttonReset } from '../lib/styleRecipes';
import { colors, fontFamily, fontSizes, fontWeights, radii, spacing, transitions } from '../lib/styleTokens';

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;

// ─── view modes ────────────────────────────────────────────────────────────────

const VIEW_BEATS = 'beats';
const VIEW_RESEARCH = 'research';
const VIEW_SPLIT = 'split';
const VIEW_MODES = [VIEW_BEATS, VIEW_RESEARCH, VIEW_SPLIT];
const VIEW_LABELS = { [VIEW_BEATS]: 'Beat Sheet', [VIEW_RESEARCH]: 'Research', [VIEW_SPLIT]: 'Split' };

const RESEARCH_TABLE = 'beat_sheet_research_docs';

// Split geometry lives in localStorage rather than the DB: it's a per-person
// window preference, not a property of the sheet.
const SPLIT_RATIO_KEY = 'production-split-ratio';
const SPLIT_SWAP_KEY = 'production-split-swapped';
const MIN_SPLIT_RATIO = 0.22;
const MAX_SPLIT_RATIO = 0.78;

function readSplitRatio() {
  try {
    const raw = parseFloat(localStorage.getItem(SPLIT_RATIO_KEY));
    if (Number.isFinite(raw)) return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, raw));
  } catch { /* storage unavailable — fall through */ }
  return 0.5;
}

function readSplitSwapped() {
  try { return localStorage.getItem(SPLIT_SWAP_KEY) === '1'; } catch { return false; }
}

// ─── helpers ───────────────────────────────────────────────────────────────────

function newBeat() {
  return { id: crypto.randomUUID(), title: '', context: '', graphics: [], videos: [], notes: '' };
}

const SEGMENT_COLORS = [
  '#5b8fc7', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b',
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

function isSegment(item) {
  return item?.type === 'segment';
}

function flattenBeats(items) {
  if (!items) return [];
  const result = [];
  for (const item of items) {
    if (isSegment(item)) {
      result.push(...(item.children || []));
    } else {
      result.push(item);
    }
  }
  return result;
}

function countBeats(items) {
  return flattenBeats(items).length;
}

function mapBeatsDeep(items, fn) {
  return items.map(item => {
    if (isSegment(item)) {
      return { ...item, children: item.children.map(fn) };
    }
    return fn(item);
  });
}

// Deep-clone a beats array with fresh UUIDs (and fresh media arrays) so the
// copy can live in a new sheet/template without colliding on ids.
function cloneBeatsFresh(items) {
  return (items || []).map(item => {
    if (isSegment(item)) {
      return {
        ...item,
        id: crypto.randomUUID(),
        children: (item.children || []).map(b => ({
          ...b,
          id: crypto.randomUUID(),
          graphics: [...(b.graphics || [])],
          videos: [...(b.videos || [])],
        })),
      };
    }
    return {
      ...item,
      id: crypto.randomUUID(),
      graphics: [...(item.graphics || [])],
      videos: [...(item.videos || [])],
    };
  });
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  // Past a week "412d ago" stops meaning anything — show the date instead.
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-US', sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' });
}

// Exact stamp for the editor bar and list hover, where the relative form is too vague.
function fullTimestamp(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

// The three hand-curated sections. Only Active/Backlog live in the `section`
// column — Completed is `is_archived`, which is what keeps a finished sheet out
// of the Deliverables / Timeline / UnifiedBoard / WriteAdReadModal pickers.
const SECTIONS = [
  { key: 'active',    label: 'Active' },
  { key: 'backlog',   label: 'Backlog' },
  { key: 'completed', label: 'Completed' },
];

function sectionOf(sheet) {
  if (sheet.is_archived) return 'completed';
  return sheet.section === 'active' ? 'active' : 'backlog';
}

// Tags that fire a workflow trigger event when first applied to a sheet.
// Carries over the old type-assignment integration; keyed by tag LABEL because
// tag ids are generated per environment.
const TAG_WORKFLOW_EVENTS = {
  'Mayday': 'new_beat_sheet_mayday',
  'Trevor May Baseball': 'new_beat_sheet_tm_baseball',
};

// Tag-add routing (2026-09-11): tagging a hand-made sheet sends it where that
// format is worked. Film-queue formats enqueue via the film-queue edge
// function (idempotent on beat_sheet_id); project formats spawn a card at
// Research linked back through projects.beat_sheet_id.
const TAG_QUEUE_TYPES = { 'Mayday': 'mayday', 'Short Form': 'short_form', 'Ad Read': 'ad' };
const TAG_PROJECT_TYPES = { 'Trevor May Baseball': 'tm_baseball_video', 'Podcast': 'podcast' };
// Applying one of these tags stamps the estimated film minutes automatically.
const TAG_DEFAULT_MINUTES = { 'Mayday': 25, 'Short Form': 5, 'Ad Read': 5 };

const TAG_PALETTE = ['#f87171', '#34d399', '#c084fc', '#fbbf24', '#38bdf8', '#8fb4d8', '#f0a3b5', '#10b981'];

function shortDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-US', sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: '2-digit' });
}

// ─── table chrome ──────────────────────────────────────────────────────────────

function SortableTh({ label, k, sort, onSort }) {
  const active = sort?.k === k;
  return (
    <button
      type="button"
      onClick={() => onSort(k)}
      style={{ ...buttonReset, ...thStyle, ...(active ? { color: colors.text } : {}) }}
      title={`Sort by ${label}`}
    >
      {label}
      {active && <span style={{ marginLeft: 4 }}>{sort.dir === 'asc' ? '\u2191' : '\u2193'}</span>}
    </button>
  );
}

// Multi-select tag popover. Mirrors the Ideas board: toggle existing tags,
// or type a new label to create one on the spot.
function TagEditor({ tags, selected, onToggle, onCreate, onClose }) {
  const [draft, setDraft] = useState('');
  const wrapRef = useRef(null);

  useEffect(() => {
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const known = new Set(tags.map(t => t.label.toLowerCase()));
  const trimmed = draft.trim();
  const canCreate = trimmed.length > 0 && !known.has(trimmed.toLowerCase());

  return (
    <div ref={wrapRef} style={tagPopoverStyle} onClick={(e) => e.stopPropagation()}>
      {tags.map(t => {
        const on = (selected || []).includes(t.id);
        return (
          <button
            key={t.id}
            type="button"
            style={{ ...buttonReset, ...tagOptionStyle, ...(on ? { background: colors.accentA12 } : {}) }}
            onClick={() => onToggle(t.id)}
          >
            <span style={{ width: 12, flexShrink: 0, color: colors.accentFg }}>{on ? '\u2713' : ''}</span>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.color, flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.label}</span>
          </button>
        );
      })}
      <div style={{ height: 1, background: colors.border, margin: `${spacing.xs}px 0` }} />
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && canCreate) { onCreate(trimmed); setDraft(''); }
        }}
        placeholder="New tag..."
        style={tagInputStyle}
      />
      {canCreate && (
        <button
          type="button"
          style={{ ...buttonReset, ...tagOptionStyle, color: colors.accentFg }}
          onClick={() => { onCreate(trimmed); setDraft(''); }}
        >
          + Create "{trimmed}"
        </button>
      )}
    </div>
  );
}

// Header and data rows share one column spec so they can never drift apart.
const TABLE_COLS = '24px minmax(200px, 2.2fr) minmax(150px, 1.4fr) 64px 96px 104px minmax(90px, 0.7fr) 118px';

const thStyle = {
  fontSize: fontSizes.xxs,
  fontWeight: fontWeights.semibold,
  color: colors.textSubtle,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  textAlign: 'left',
  cursor: 'pointer',
  padding: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const tagPopoverStyle = {
  position: 'absolute',
  top: '100%',
  left: 0,
  zIndex: 200,
  minWidth: 200,
  maxHeight: 280,
  overflowY: 'auto',
  padding: spacing.xs,
  background: colors.bgModal,
  border: `1px solid ${colors.borderStrong}`,
  borderRadius: radii.md,
  boxShadow: '0 10px 32px rgba(0,0,0,0.55)',
};

const tagOptionStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: spacing.sm,
  width: '100%',
  padding: `${spacing.xs}px ${spacing.sm}px`,
  borderRadius: radii.xs,
  fontSize: fontSizes.sm,
  color: colors.text,
  cursor: 'pointer',
  textAlign: 'left',
};

const tagInputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: `${spacing.xs}px ${spacing.sm}px`,
  background: colors.bgInput,
  border: `1px solid ${colors.border}`,
  borderRadius: radii.xs,
  color: colors.text,
  fontSize: fontSizes.sm,
  fontFamily: 'inherit',
  outline: 'none',
};

// ─── component ─────────────────────────────────────────────────────────────────

export default function Production({ initialSheetId, onSheetOpened }) {
  const { profile, isAdmin } = useAuth();
  const confirm = useConfirm();

  // ── landing state ──
  const [sheets, setSheets] = useState([]);
  const [loading, setLoading] = useState(true);

  // ── editor state ──
  const [activeSheet, setActiveSheet] = useState(null);
  const [title, setTitle] = useState('');
  const [beats, setBeats] = useState([]);
  const [driveFolderId, setDriveFolderId] = useState(null);
  const [driveFolderName, setDriveFolderName] = useState(null);
  const [saveStatus, setSaveStatus] = useState('saved');
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const saveTimer = useRef(null);
  const justLoadedSheet = useRef(false); // skip the autosave fired by openSheet's state writes
  const tagDragRef = useRef(null);

  // ── view mode: Beat Sheet / Research / Split ──
  // The research doc is a separate row (one per sheet) rather than a column on
  // beat_sheets, so the Tiptap autosave can own its own table without racing
  // the beat autosave that writes the sheet row every 1.5s.
  const [viewMode, setViewMode] = usePersistedTab('production-view', VIEW_BEATS, VIEW_MODES);
  const [splitSwapped, setSplitSwapped] = useState(() => readSplitSwapped());
  const [splitRatio, setSplitRatio] = useState(() => readSplitRatio());
  const [researchDoc, setResearchDoc] = useState(null);
  const [researchError, setResearchError] = useState(null);
  const splitWrapRef = useRef(null);
  const dragRatio = useRef(null); // latest ratio during a drag, for the mouseup persist

  // ── folder browser state ──
  const [showFolderBrowser, setShowFolderBrowser] = useState(false);
  const [folderStack, setFolderStack] = useState([]);
  const [folders, setFolders] = useState([]);
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  // ── push state ──
  const [pushingSheet, setPushingSheet] = useState(false);
  const [pushingScript, setPushingScript] = useState(false);
  const [toast, setToast] = useState(null);

  // ── tag input state ──
  const [tagInputs, setTagInputs] = useState({});

  // ── context visibility state ──
  const [expandedContexts, setExpandedContexts] = useState(new Set());

  // ── beat media upload state ──
  const [uploadingCells, setUploadingCells] = useState({});
  const [dropHighlight, setDropHighlight] = useState(null);

  // ── context menu ──
  const [contextMenu, setContextMenu] = useState(null); // { x, y, beatId, segmentId, isSegmentHeader }

  // ── inline tag edit (context menu → Edit on a Graphics/Videos tag) ──
  const [editingTag, setEditingTag] = useState(null); // { beatId, field, index, value }

  // ── Find Assets ──
  const [findAssetsOpen, setFindAssetsOpen] = useState(false);
  // "Done" mark on a B-Roll/Images tag (asset already sourced elsewhere) —
  // Find Assets skips it. Stored in beat_sheets.asset_review under the same
  // key scheme the modal uses. Surfaced through the beat context menu: a tag
  // right-click opens the normal menu with a Mark done entry prepended.
  const tagDone = (beatId, field, tag) =>
    (activeSheet?.asset_review || {})[`${beatId}::${field}::${tag}`]?.status === 'done';
  const toggleTagDone = async (key, makeDone) => {
    if (!activeSheet) return;
    const next = { ...(activeSheet.asset_review || {}) };
    if (makeDone) next[key] = { status: 'done' };
    else delete next[key];
    setActiveSheet((prev) => (prev ? { ...prev, asset_review: next } : prev));
    const { error } = await supabase.from('beat_sheets').update({ asset_review: next }).eq('id', activeSheet.id);
    if (error) console.error('asset_review save failed:', error.message);
  };

  // ── templates ──
  // Actions dropdown (toolbar far right): null | 'menu' | 'templates'
  const [actionsMenu, setActionsMenu] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const templateBtnRef = useRef(null);

  // ── new-sheet create modal ──
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createTemplateId, setCreateTemplateId] = useState(null); // null = blank
  const [createTagId, setCreateTagId] = useState(null); // required — routes the sheet on create
  const [createBusy, setCreateBusy] = useState(false);

  // ── add menu ──
  const [showAddMenuTop, setShowAddMenuTop] = useState(false);
  const [showAddMenuBottom, setShowAddMenuBottom] = useState(false);
  const [showColorDropdown, setShowColorDropdown] = useState(null); // segmentId or null

  // ── confirm delete ──
  const [confirmDelete, setConfirmDelete] = useState(null);

  // ── landing list: type sections + row context menu ──
  // Sections are keyed by type key ('mayday', …), plus '__unassigned' and
  // 'archive'. Only Archive is collapsed by default.
  // Completed holds the majority of sheets, so it starts collapsed and the page
  // opens on live work instead of a wall of finished ones.
  const [collapsedSections, setCollapsedSections] = useState(new Set(['completed']));
  const [tags, setTags] = useState([]);
  const [people, setPeople] = useState({});
  const [tagEditorId, setTagEditorId] = useState(null);
  // View-only sort override. null = manual drag order, which is the default and
  // the only mode where dragging makes sense.
  const [sort, setSort] = useState(null);
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y, sheet }
  const [renamingSheetId, setRenamingSheetId] = useState(null);
  const [renameSheetValue, setRenameSheetValue] = useState('');
  const [collapsedSegments, setCollapsedSegments] = useState(new Set());

  // ── version history ──
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [versions, setVersions] = useState([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [previewVersion, setPreviewVersion] = useState(null);
  const snapshotTimer = useRef(null);
  const lastSnapshotBeats = useRef(null);
  const beatsRef = useRef(beats);
  const titleRef = useRef(title);

  // ── keep refs in sync for interval callback ──
  useEffect(() => { beatsRef.current = beats; }, [beats]);
  useEffect(() => { titleRef.current = title; }, [title]);

  // ─── fetch sheets ───────────────────────────────────────────────────────────
  // Fetch ALL sheets (archived included) — the landing page groups them by type
  // and renders archived ones in the collapsed Archive section.
  const fetchSheets = useCallback(async () => {
    setLoading(true);
    const [data, tagRes, peopleRes] = await Promise.all([
      fetchAllRows(
        supabase
          .from('beat_sheets')
          .select('*')
          .order('position', { ascending: true })
      ),
      supabase.from('beat_sheet_tags').select('*').order('position', { ascending: true }),
      supabase.from('profiles').select('id, full_name'),
    ]);
    setSheets(data || []);
    setTags(tagRes.data || []);
    const map = {};
    for (const row of (peopleRes.data || [])) map[row.id] = row.full_name;
    setPeople(map);
    setLoading(false);
  }, []);

  useEffect(() => { fetchSheets(); }, [fetchSheets]);

  // ─── initial textarea sizing ─────────────────────────────────────────────────
  // Run once when a sheet opens so textareas match their stored content height.
  // We do NOT use inline ref callbacks (ref={el => autoResize(el)}) because
  // those fire on every re-render (React treats each new fn reference as
  // unmount+remount), calling autoResize on every saveStatus change which
  // triggers height:'auto', a layout shift, and a scroll-to-top.
  useEffect(() => {
    if (!activeSheet) return;
    requestAnimationFrame(() => {
      document.querySelectorAll('[data-autoresize]').forEach(autoResize);
    });
  }, [activeSheet?.id]);

  // ─── auto-save ──────────────────────────────────────────────────────────────
  const scheduleSave = useCallback(() => {
    if (!activeSheet) return;
    setSaveStatus('unsaved');
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaveStatus('saving');
      const savedAt = new Date().toISOString();
      const { error } = await supabase
        .from('beat_sheets')
        .update({
          title,
          beats,
          drive_folder_id: driveFolderId,
          drive_folder_name: driveFolderName,
          updated_at: savedAt,
        })
        .eq('id', activeSheet.id);
      if (error) {
        console.error('Auto-save error:', error);
        setSaveStatus('unsaved');
      } else {
        setSaveStatus('saved');
        setLastSavedAt(savedAt);
        setSheets(prev => prev.map(s => (s.id === activeSheet.id ? { ...s, updated_at: savedAt } : s)));
      }
    }, 1500);
  }, [activeSheet, title, beats, driveFolderId, driveFolderName]);

  useEffect(() => {
    // Don't autosave the data openSheet just loaded — only real user edits.
    if (justLoadedSheet.current) { justLoadedSheet.current = false; return; }
    if (activeSheet) scheduleSave();
    return () => clearTimeout(saveTimer.current);
  }, [title, beats, driveFolderId, driveFolderName]);

  // ─── research document ──────────────────────────────────────────────────────
  // One doc per sheet, created the first time somebody opens Research. The
  // unique constraint on beat_sheet_id is the real guard: if two tabs get here
  // at once, one insert loses the race and we re-select the winner's row rather
  // than surfacing an error.
  const ensureResearchDoc = useCallback(async (sheetId) => {
    setResearchError(null);

    const selectDoc = () => supabase
      .from(RESEARCH_TABLE)
      .select('id, summary')
      .eq('beat_sheet_id', sheetId)
      .maybeSingle();

    const { data: existing, error: selectError } = await selectDoc();
    if (selectError) {
      console.error('Research doc load failed:', selectError.message);
      setResearchError(selectError.message);
      return;
    }
    if (existing) { setResearchDoc(existing); return; }

    const { data: created, error: insertError } = await supabase
      .from(RESEARCH_TABLE)
      .insert({ beat_sheet_id: sheetId, created_by: profile?.id ?? null })
      .select('id, summary')
      .single();

    if (!insertError) { setResearchDoc(created); return; }

    // 23505 = the other tab won. Anything else is a real failure.
    if (insertError.code === '23505') {
      const { data: winner } = await selectDoc();
      if (winner) { setResearchDoc(winner); return; }
    }
    console.error('Research doc create failed:', insertError.message);
    setResearchError(insertError.message);
  }, [profile?.id]);

  useEffect(() => { setResearchDoc(null); setResearchError(null); }, [activeSheet?.id]);

  useEffect(() => {
    if (!activeSheet || viewMode === VIEW_BEATS) return;
    if (researchDoc || researchError) return;
    ensureResearchDoc(activeSheet.id);
  }, [activeSheet, viewMode, researchDoc, researchError, ensureResearchDoc]);

  // ─── split divider drag ─────────────────────────────────────────────────────
  const startSplitDrag = useCallback((e) => {
    e.preventDefault();
    const wrap = splitWrapRef.current;
    if (!wrap) return;

    const onMove = (moveEvent) => {
      const rect = wrap.getBoundingClientRect();
      if (!rect.width) return;
      const ratio = Math.min(
        MAX_SPLIT_RATIO,
        Math.max(MIN_SPLIT_RATIO, (moveEvent.clientX - rect.left) / rect.width)
      );
      dragRatio.current = ratio;
      setSplitRatio(ratio);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      if (dragRatio.current !== null) {
        try { localStorage.setItem(SPLIT_RATIO_KEY, String(dragRatio.current)); } catch { /* ignore */ }
        dragRatio.current = null;
      }
    };

    // Suppress text selection for the duration — dragging over the beat
    // textareas would otherwise select their contents.
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  const toggleSplitSwap = useCallback(() => {
    setSplitSwapped(prev => {
      const next = !prev;
      try { localStorage.setItem(SPLIT_SWAP_KEY, next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  }, []);

  // ─── toast auto-dismiss ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // ─── CRUD ───────────────────────────────────────────────────────────────────
  const openCreateModal = () => {
    setCreateName('');
    setCreateTemplateId(null);
    setCreateTagId(null);
    setShowCreateModal(true);
    fetchTemplates();
  };

  const confirmCreate = async () => {
    const name = createName.trim();
    if (!name || !createTagId || createBusy) return;
    setCreateBusy(true);
    let initialBeats = [newBeat()];
    if (createTemplateId) {
      const tpl = templates.find(t => t.id === createTemplateId);
      const cloned = cloneBeatsFresh(tpl?.beats || []);
      if (cloned.length) initialBeats = cloned;
    }
    // New sheets land at the end of Active: you just made it, so it's what
    // you're on. Position is computed rather than left to the column default,
    // which would park every new sheet at 0 and make their relative order
    // arbitrary.
    const activeCount = sheets.filter(sheet => !sheet.is_archived && sheet.section === 'active').length;
    const { data, error } = await supabase
      .from('beat_sheets')
      .insert({
        user_id: profile.id, title: name, beats: initialBeats, section: 'active',
        position: activeCount, tag_ids: [createTagId],
        estimated_minutes: TAG_DEFAULT_MINUTES[tagById[createTagId]?.label] ?? null,
      })
      .select()
      .single();
    setCreateBusy(false);
    if (error) { console.error(error); return; }
    setShowCreateModal(false);
    // The required tag routes the sheet immediately: film-queue formats
    // enqueue (writer = creator), project formats spawn a Research card with
    // the creator as the Write-stage assignee. Fire-and-forget so the editor
    // opens without waiting on the round-trips.
    const tagLabel = tagById[createTagId]?.label;
    fireTagWorkflow(data, tagLabel);
    routeTagDestination(data, tagLabel);
    openSheet(data);
  };

  const duplicateSheet = async (sheet) => {
    const clonedBeats = (sheet.beats || []).map(item => {
      if (isSegment(item)) {
        return {
          ...item,
          id: crypto.randomUUID(),
          children: (item.children || []).map(b => ({ ...b, id: crypto.randomUUID() })),
        };
      }
      return { ...item, id: crypto.randomUUID() };
    });
    const { data, error } = await supabase
      .from('beat_sheets')
      .insert({
        user_id: profile.id,
        title: `${sheet.title} (copy)`,
        beats: clonedBeats,
        type: sheet.type || null,
      })
      .select()
      .single();
    if (error) { console.error('Duplicate error:', error); return; }
    setSheets(prev => [data, ...prev]);
  };

  // ─── type assignment ──────────────────────────────────────────────────────────
  const renameSheet = async (id, newTitle) => {
    const t = newTitle.trim();
    if (!t) return;
    const savedAt = new Date().toISOString();
    setSheets(prev => prev.map(s => (s.id === id ? { ...s, title: t, updated_at: savedAt } : s)));
    setActiveSheet(prev => (prev && prev.id === id ? { ...prev, title: t } : prev));
    if (activeSheet?.id === id) { setTitle(t); setLastSavedAt(savedAt); }
    const { error } = await supabase
      .from('beat_sheets')
      .update({ title: t, updated_at: savedAt })
      .eq('id', id);
    if (error) console.error('Rename error:', error);
  };

  // ── landing helpers: section collapse + row context menu + inline rename ──
  const toggleSection = (key) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  // ── landing table: tags, grouping, sorting, drag ──

  const tagById = useMemo(() => Object.fromEntries(tags.map(t => [t.id, t])), [tags]);
  const tagsForSheet = useCallback(
    (sheet) => (sheet.tag_ids || []).map(id => tagById[id]).filter(Boolean),
    [tagById],
  );
  const creatorName = useCallback((userId) => people[userId] || '\u2014', [people]);

  const onSort = (k) => {
    setSort(prev => {
      if (prev?.k !== k) return { k, dir: 'asc' };
      if (prev.dir === 'asc') return { k, dir: 'desc' };
      return null;   // third click returns to manual order
    });
  };

  // Sheets bucketed by section, each in position order — or in the sort order
  // when a column sort is active.
  const groupedSheets = useMemo(() => {
    const out = { active: [], backlog: [], completed: [] };
    for (const sheet of sheets) out[sectionOf(sheet)].push(sheet);

    const cmp = (a, b) => {
      if (!sort) return (a.position ?? 0) - (b.position ?? 0);
      const dir = sort.dir === 'asc' ? 1 : -1;
      const val = (x) => {
        switch (sort.k) {
          case 'title':   return (x.title || '').toLowerCase();
          case 'tags':    return tagsForSheet(x).map(t => t.label).join(', ').toLowerCase();
          case 'beats':   return countBeats(x.beats || []);
          case 'created': return x.created_at || '';
          case 'updated': return x.updated_at || '';
          case 'who':     return creatorName(x.user_id).toLowerCase();
          case 'status':  return BEAT_SHEET_STATUSES.findIndex(s => s.value === (x.status || 'drafting'));
          default:        return 0;
        }
      };
      const av = val(a), bv = val(b);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return (a.position ?? 0) - (b.position ?? 0);
    };

    for (const key of Object.keys(out)) out[key].sort(cmp);
    return out;
  }, [sheets, sort, tagsForSheet, creatorName]);

  // Apply a move optimistically, then persist only the rows that actually
  // changed. Writing every row in both sections would mean ~44 round-trips to
  // drop one sheet at the top of Completed.
  const applyMove = useCallback(async (sheetId, dstKey, insertIndex) => {
    const moved = sheets.find(s => s.id === sheetId);
    if (!moved) return;
    const srcKey = sectionOf(moved);
    const sameSection = srcKey === dstKey;

    const src = (groupedSheets[srcKey] || []).filter(s => s.id !== sheetId);
    const dst = sameSection ? src : [...(groupedSheets[dstKey] || [])];
    const at = insertIndex == null || insertIndex < 0 || insertIndex > dst.length ? dst.length : insertIndex;
    dst.splice(at, 0, moved);

    const isCompleted = dstKey === 'completed';
    const desired = new Map();
    if (!sameSection) {
      // The source section closes its gap, but its section/archived flags are
      // unchanged — only position moves.
      src.forEach((sheet, idx) => desired.set(sheet.id, {
        position: idx,
        is_archived: sheet.is_archived,
        section: sheet.section,
      }));
    }
    dst.forEach((sheet, idx) => desired.set(sheet.id, {
      position: idx,
      is_archived: isCompleted,
      // Completed keeps no section of its own; dragging back out lands in
      // Backlog, so that is what gets written on the way in as well.
      section: isCompleted ? 'backlog' : dstKey,
    }));

    // Drop no-ops before touching the network.
    const byId = new Map(sheets.map(sheet => [sheet.id, sheet]));
    const changed = [...desired.entries()].filter(([id, next]) => {
      const cur = byId.get(id);
      return !cur
        || (cur.position ?? 0) !== next.position
        || Boolean(cur.is_archived) !== Boolean(next.is_archived)
        || (cur.section || 'backlog') !== next.section;
    });
    if (!changed.length) return;

    const patch = new Map(changed);
    setSheets(prev => prev.map(sheet => (patch.has(sheet.id) ? { ...sheet, ...patch.get(sheet.id) } : sheet)));

    const results = await Promise.all(changed.map(([id, next]) => supabase
      .from('beat_sheets')
      .update(next)
      .eq('id', id)));
    const failed = results.filter(r => r.error);
    if (failed.length) {
      console.error('Beat sheet reorder failed:', failed.map(r => r.error));
      fetchSheets();
    }
  }, [sheets, groupedSheets, fetchSheets]);

  const onSheetDragEnd = useCallback((result) => {
    const { draggableId, source, destination } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) return;
    applyMove(draggableId, destination.droppableId, destination.index);
  }, [applyMove]);

  // Context-menu fallback for moving without dragging.
  const moveSheetToSection = useCallback((sheet, dstKey) => {
    applyMove(sheet.id, dstKey, null);
  }, [applyMove]);

  // ── tags ──

  const fireTagWorkflow = useCallback(async (sheet, label) => {
    const ev = TAG_WORKFLOW_EVENTS[label];
    if (!ev) return;
    try {
      await callWorkflowFn('workflow-trigger-event', {
        event: ev,
        payload: { beat_sheet_id: sheet.id, title: sheet.title || 'Untitled' },
      });
    } catch (e) {
      console.error('Beat sheet trigger failed:', e);
    }
  }, []);

  // Route a newly applied tag to its destination system. Both paths are
  // duplicate-safe: enqueue_sheet is idempotent on beat_sheet_id, and the
  // project path skips when a live card already links this sheet.
  // ── status / minutes (film queue fields) ──
  // Direct column writes like writeTagIds — the 1.5s autosave only covers
  // title/beats, so these persist immediately on change. A manual flip to
  // approved stamps approved_at (the line orders on it); leaving approved
  // clears it. Film date is packer-set, never written here. Declared above
  // the tag handlers because toggleSheetTag stamps default minutes with it.
  const writeSheetFields = useCallback(async (sheet, patch) => {
    setSheets(prev => prev.map(s => (s.id === sheet.id ? { ...s, ...patch } : s)));
    setActiveSheet(prev => (prev && prev.id === sheet.id ? { ...prev, ...patch } : prev));
    const { error } = await supabase.from('beat_sheets').update(patch).eq('id', sheet.id);
    if (error) { console.error('Sheet field update error:', error); fetchSheets(); }
  }, [fetchSheets]);

  const routeTagDestination = useCallback(async (sheet, label) => {
    const queueType = TAG_QUEUE_TYPES[label];
    if (queueType) {
      try {
        await callWorkflowFn('film-queue', { action: 'enqueue_sheet', beat_sheet_id: sheet.id, queue_type: queueType });
      } catch (e) {
        console.error('Film queue enqueue failed:', e);
      }
      return;
    }
    const projectType = TAG_PROJECT_TYPES[label];
    if (!projectType) return;
    try {
      const { data: existing } = await supabase.from('projects')
        .select('id').eq('beat_sheet_id', sheet.id).is('archived_at', null).limit(1);
      if (existing && existing.length > 0) return;
      // Same shape as Ideas → Add Project: create in Queue with Research
      // un-skipped, seed default assignees (+ a queue-stage row for the
      // creator so their card-move passes the stage-assignee check), then
      // advance through card-move so Research assignees get their tasks.
      const cfg = defaultStageConfigForType(projectType);
      delete cfg.research;
      const { data: created, error } = await supabase.from('projects').insert({
        name: sheet.title || 'Untitled',
        type: projectType,
        status: 'queue',
        start_column: 'research',
        beat_sheet_id: sheet.id,
        stage_config: cfg,
        created_by: profile?.id || null,
      }).select('id').single();
      if (error) throw new Error(error.message);
      let seedRows = await fetchDefaultAssigneeRows(supabase, projectType, created.id);
      if (profile?.id) {
        // The sheet's creator is the writer — they replace the type's
        // default Write-stage assignees on this card.
        seedRows = seedRows.filter((r) => r.stage !== 'write');
        seedRows.push({ project_id: created.id, stage: 'write', user_id: profile.id });
        if (!seedRows.some((r) => r.stage === 'queue' && r.user_id === profile.id)) {
          seedRows.push({ project_id: created.id, stage: 'queue', user_id: profile.id });
        }
      }
      const { error: aErr } = await supabase.from('project_stage_assignments').insert(seedRows);
      if (aErr) console.error('Assignee seed failed:', aErr);
      await callWorkflowFn('card-move', { project_id: created.id, target_stage: 'research' });
    } catch (e) {
      console.error('Auto project creation failed:', e);
    }
  }, [profile?.id]);

  const writeTagIds = useCallback(async (sheet, nextIds) => {
    setSheets(prev => prev.map(s => (s.id === sheet.id ? { ...s, tag_ids: nextIds } : s)));
    setActiveSheet(prev => (prev && prev.id === sheet.id ? { ...prev, tag_ids: nextIds } : prev));
    const { error } = await supabase.from('beat_sheets').update({ tag_ids: nextIds }).eq('id', sheet.id);
    if (error) { console.error('Tag update error:', error); fetchSheets(); return false; }
    return true;
  }, [fetchSheets]);

  const toggleSheetTag = useCallback(async (sheet, tagId) => {
    const current = sheet.tag_ids || [];
    const adding = !current.includes(tagId);
    const next = adding ? [...current, tagId] : current.filter(id => id !== tagId);
    const ok = await writeTagIds(sheet, next);
    // Only an ADD fires the workflow, and only the first time — removing and
    // re-adding is the one case that can legitimately re-fire.
    if (ok && adding) {
      const label = tagById[tagId]?.label;
      if (TAG_DEFAULT_MINUTES[label] != null) {
        writeSheetFields(sheet, { estimated_minutes: TAG_DEFAULT_MINUTES[label] });
      }
      await fireTagWorkflow(sheet, label);
      await routeTagDestination(sheet, label);
    }
  }, [writeTagIds, writeSheetFields, fireTagWorkflow, routeTagDestination, tagById]);

  const createTagFor = useCallback(async (sheet, label) => {
    const color = TAG_PALETTE[tags.length % TAG_PALETTE.length];
    const { data, error } = await supabase
      .from('beat_sheet_tags')
      .insert({ label, color, position: tags.length, created_by: profile?.id })
      .select()
      .single();
    if (error) { console.error('Tag create error:', error); return; }
    setTags(prev => [...prev, data]);
    const ok = await writeTagIds(sheet, [...(sheet.tag_ids || []), data.id]);
    if (ok) {
      await fireTagWorkflow(sheet, data.label);
      await routeTagDestination(sheet, data.label);
    }
  }, [tags.length, profile?.id, writeTagIds, fireTagWorkflow, routeTagDestination]);

  const setSheetStatus = useCallback((sheet, status) => {
    const patch = { status };
    if (status === 'approved') patch.approved_at = new Date().toISOString();
    else if (sheet.status === 'approved') patch.approved_at = null;
    writeSheetFields(sheet, patch);
  }, [writeSheetFields]);

  const openCtx = (e, sheet) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, sheet }); };
  const closeCtx = () => setCtxMenu(null);
  const startRename = (sheet) => { setRenamingSheetId(sheet.id); setRenameSheetValue(sheet.title || ''); };
  const commitRename = async (id) => {
    const t = renameSheetValue.trim();
    setRenamingSheetId(null);
    if (t) await renameSheet(id, t);
  };

  const openSheet = (sheet) => {
    justLoadedSheet.current = true;
    setActiveSheet(sheet);
    setTitle(sheet.title);
    const loadedBeats = sheet.beats || [newBeat()];
    setBeats(loadedBeats);
    setDriveFolderId(sheet.drive_folder_id);
    setDriveFolderName(sheet.drive_folder_name);
    setSaveStatus('saved');
    setLastSavedAt(sheet.updated_at || null);
    setTagInputs({});
    setExpandedContexts(new Set(flattenBeats(loadedBeats).filter(b => b.context).map(b => b.id)));
    window.history.replaceState({}, '', '/production/' + sheet.id);
  };

  // Deep link: open a specific sheet when navigated here with a target id
  // (e.g. the "Start the Beat Sheet" button in My Tasks).
  useEffect(() => {
    if (!initialSheetId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('beat_sheets').select('*').eq('id', initialSheetId).single();
      if (!cancelled && data) openSheet(data);
      if (onSheetOpened) onSheetOpened();
    })();
    return () => { cancelled = true; };
  }, [initialSheetId]);

  // Restore sheet from URL on refresh (safety net when initialSheetId isn't provided)
  useEffect(() => {
    if (initialSheetId) return;
    const urlSheetId = window.location.pathname.replace(/^\/+/, '').split('/')[1];
    if (!urlSheetId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('beat_sheets').select('*').eq('id', urlSheetId).single();
      if (!cancelled && data) openSheet(data);
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line

  const closeEditor = async () => {
    clearTimeout(saveTimer.current);
    clearInterval(snapshotTimer.current);
    // force-save before leaving if unsaved; await so fetchSheets gets fresh data
    if (saveStatus !== 'saved' && activeSheet) {
      const savedAt = new Date().toISOString();
      await supabase.from('beat_sheets').update({
        title, beats,
        drive_folder_id: driveFolderId,
        drive_folder_name: driveFolderName,
        updated_at: savedAt,
      }).eq('id', activeSheet.id);
      setLastSavedAt(savedAt);
    }
    // save version snapshot on close
    if (activeSheet) await saveSnapshot(activeSheet.id, title, beats);
    window.history.replaceState({}, '', '/production');
    setActiveSheet(null);
    setShowVersionHistory(false);
    setVersions([]);
    setPreviewVersion(null);
    fetchSheets();
  };

  const deleteSheet = async (id, title) => {
    if (!(await confirm(`Delete "${title}"? This cannot be undone.`))) return;
    setSheets(prev => prev.filter(s => s.id !== id));
    const { error } = await supabase.from('beat_sheets').delete().eq('id', id);
    if (error) { console.error('Delete error:', error); fetchSheets(); }
  };

  // ─── version history ──────────────────────────────────────────────────────

  const saveSnapshot = async (sheetId, snapshotTitle, snapshotBeats) => {
    const serialized = JSON.stringify(snapshotBeats);
    if (serialized === lastSnapshotBeats.current) return; // skip duplicate
    lastSnapshotBeats.current = serialized;
    await supabase.from('beat_sheet_versions').insert({
      sheet_id: sheetId,
      title: snapshotTitle,
      beats: snapshotBeats,
      beat_count: countBeats(snapshotBeats || []),
      saved_by: profile?.id || null,
    });
  };

  // periodic snapshot every 10 minutes while editor is open
  useEffect(() => {
    if (!activeSheet) return;
    lastSnapshotBeats.current = JSON.stringify(beats);
    snapshotTimer.current = setInterval(() => {
      saveSnapshot(activeSheet.id, titleRef.current, beatsRef.current);
    }, 10 * 60 * 1000);
    return () => clearInterval(snapshotTimer.current);
  }, [activeSheet?.id]);

  // close add menus and color dropdown on outside click
  useEffect(() => {
    if (!showAddMenuTop && !showAddMenuBottom && !showColorDropdown) return;
    const handler = (e) => {
      // Don't close if click is inside a dropdown
      if (e.target.closest('[data-add-menu]') || e.target.closest('[data-color-dropdown]')) return;
      setShowAddMenuTop(false);
      setShowAddMenuBottom(false);
      setShowColorDropdown(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showAddMenuTop, showAddMenuBottom, showColorDropdown]);

  // close the Actions dropdown on outside click
  useEffect(() => {
    if (!actionsMenu) return;
    const handler = (e) => {
      if (templateBtnRef.current && !templateBtnRef.current.parentElement.contains(e.target)) {
        setActionsMenu(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [actionsMenu]);

  const fetchVersions = async (sheetId) => {
    setVersionsLoading(true);
    const { data, error } = await supabase
      .from('beat_sheet_versions')
      .select('id, title, beat_count, created_at')
      .eq('sheet_id', sheetId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) console.error('Fetch versions error:', error);
    setVersions(data || []);
    setVersionsLoading(false);
  };

  const previewVersionData = async (versionId) => {
    const { data, error } = await supabase
      .from('beat_sheet_versions')
      .select('*')
      .eq('id', versionId)
      .single();
    if (error) { console.error('Preview version error:', error); return; }
    setPreviewVersion(data);
  };

  const restoreVersion = async (version) => {
    if (!(await confirm('Restore this version? Your current beats will be saved as a snapshot first.'))) return;
    // snapshot current state before restoring
    await saveSnapshot(activeSheet.id, title, beats);
    // apply restored version
    setTitle(version.title);
    setBeats(version.beats || []);
    setExpandedContexts(new Set(flattenBeats(version.beats || []).filter(b => b.context).map(b => b.id)));
    setShowVersionHistory(false);
    setPreviewVersion(null);
    // scheduleSave will auto-fire from the state change
  };

  const openVersionHistory = () => {
    if (!activeSheet) return;
    fetchVersions(activeSheet.id);
    setPreviewVersion(null);
    setShowVersionHistory(true);
  };

  // ─── beat operations ────────────────────────────────────────────────────────
  const addBeat = () => setBeats(prev => [...prev, newBeat()]);

  const updateBeat = (beatId, field, value) => {
    setBeats(prev => mapBeatsDeep(prev, b => b.id === beatId ? { ...b, [field]: value } : b));
  };

  const deleteBeat = (beatId) => {
    setBeats(prev => prev.reduce((acc, item) => {
      if (isSegment(item)) {
        const filtered = item.children.filter(b => b.id !== beatId);
        if (filtered.length !== item.children.length) {
          acc.push({ ...item, children: filtered });
        } else {
          acc.push(item);
        }
      } else if (item.id !== beatId) {
        acc.push(item);
      }
      return acc;
    }, []));
  };

  const duplicateBeat = (beatId) => {
    setBeats(prev => {
      // Check top level
      const topIdx = prev.findIndex(b => !isSegment(b) && b.id === beatId);
      if (topIdx !== -1) {
        const src = prev[topIdx];
        const copy = { ...src, id: crypto.randomUUID(), graphics: [...(src.graphics || [])], videos: [...(src.videos || [])] };
        const next = [...prev];
        next.splice(topIdx + 1, 0, copy);
        return next;
      }
      // Check inside segments
      return prev.map(item => {
        if (!isSegment(item)) return item;
        const idx = item.children.findIndex(b => b.id === beatId);
        if (idx === -1) return item;
        const src = item.children[idx];
        const copy = { ...src, id: crypto.randomUUID(), graphics: [...(src.graphics || [])], videos: [...(src.videos || [])] };
        const children = [...item.children];
        children.splice(idx + 1, 0, copy);
        return { ...item, children };
      });
    });
  };

  const addTag = (beatId, field, value) => {
    if (!value.trim()) return;
    setBeats(prev => mapBeatsDeep(prev, b =>
      b.id === beatId ? { ...b, [field]: [...b[field], value.trim()] } : b
    ));
  };

  const removeTag = (beatId, field, index) => {
    setBeats(prev => mapBeatsDeep(prev, b =>
      b.id === beatId ? { ...b, [field]: b[field].filter((_, i) => i !== index) } : b
    ));
  };

  const renameTag = async (beatId, field, index, newValue) => {
    const val = newValue.trim();
    const beat = flattenBeats(beats).find(b => b.id === beatId);
    const oldVal = beat?.[field]?.[index];
    if (!val || typeof oldVal !== 'string' || val === oldVal) return;
    setBeats(prev => mapBeatsDeep(prev, b => {
      if (b.id !== beatId) return b;
      const arr = [...b[field]];
      arr[index] = val;
      return { ...b, [field]: arr };
    }));
    // The Find Assets "done" mark is keyed by tag text — carry it over.
    const oldKey = `${beatId}::${field}::${oldVal}`;
    if (activeSheet && (activeSheet.asset_review || {})[oldKey]) {
      const next = { ...activeSheet.asset_review };
      next[`${beatId}::${field}::${val}`] = next[oldKey];
      delete next[oldKey];
      setActiveSheet(prev => (prev ? { ...prev, asset_review: next } : prev));
      const { error } = await supabase.from('beat_sheets').update({ asset_review: next }).eq('id', activeSheet.id);
      if (error) console.error('asset_review save failed:', error.message);
    }
  };

  const autoResize = (el) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  };

  const reorderTag = (beatId, field, fromIndex, toIndex) => {
    setBeats(prev => mapBeatsDeep(prev, b => {
      if (b.id !== beatId) return b;
      const arr = [...b[field]];
      const [moved] = arr.splice(fromIndex, 1);
      arr.splice(toIndex, 0, moved);
      return { ...b, [field]: arr };
    }));
  };

  const moveTagAcrossBeats = (fromBeatId, field, fromIndex, toBeatId) => {
    setBeats(prev => {
      const allBeats = flattenBeats(prev);
      const fromBeat = allBeats.find(b => b.id === fromBeatId);
      if (!fromBeat) return prev;
      const movedItem = fromBeat[field][fromIndex];
      return mapBeatsDeep(prev, b => {
        if (b.id === fromBeatId) return { ...b, [field]: b[field].filter((_, i) => i !== fromIndex) };
        if (b.id === toBeatId) return { ...b, [field]: [...b[field], movedItem] };
        return b;
      });
    });
  };

  const uploadBeatMedia = useCallback(async (beatId, field, file) => {
    const cellKey = `${beatId}-${field}`;
    setUploadingCells(prev => ({ ...prev, [cellKey]: true }));
    try {
      const ext = file.name.split('.').pop();
      const path = `${beatId}/${field}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from('beat-media').upload(path, file);
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from('beat-media').getPublicUrl(path);
      const mediaObj = {
        name: file.name,
        url: publicUrl,
        type: file.type.startsWith('image/') ? 'image' : 'video',
      };
      setBeats(prev => mapBeatsDeep(prev, b =>
        b.id === beatId ? { ...b, [field]: [...b[field], mediaObj] } : b
      ));
    } catch (err) {
      console.error('Beat media upload failed:', err);
    } finally {
      setUploadingCells(prev => { const n = { ...prev }; delete n[cellKey]; return n; });
    }
  }, []);

  const handleBulletKeyDown = (e, beatId, field) => {
    if (e.key !== 'Enter') return;
    const ta = e.target;
    const { value, selectionStart } = ta;
    const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
    const currentLine = value.slice(lineStart, selectionStart);
    const bulletMatch = currentLine.match(/^(\s*[•\-]\s)/);
    if (!bulletMatch) return;
    e.preventDefault();
    const prefix = bulletMatch[1];
    if (currentLine === prefix) {
      // Empty bullet — remove it
      const newValue = value.slice(0, lineStart) + value.slice(lineStart + prefix.length);
      updateBeat(beatId, field, newValue);
      setTimeout(() => { ta.selectionStart = ta.selectionEnd = lineStart; }, 0);
    } else {
      // Continue bullet on next line
      const newValue = value.slice(0, selectionStart) + '\n' + prefix + value.slice(selectionStart);
      updateBeat(beatId, field, newValue);
      setTimeout(() => { ta.selectionStart = ta.selectionEnd = selectionStart + 1 + prefix.length; }, 0);
    }
  };

  const addBeatToTop = () => setBeats(prev => [newBeat(), ...prev]);
  const addSegmentToTop = () => setBeats(prev => [newSegment(), ...prev]);

  // ─── segment operations ──────────────────────────────────────────────────────
  const addSegment = () => setBeats(prev => [...prev, newSegment()]);

  const addBeatToSegment = (segmentId) => {
    setBeats(prev => prev.map(item =>
      isSegment(item) && item.id === segmentId
        ? { ...item, children: [...item.children, newBeat()] }
        : item
    ));
  };

  const updateSegment = (segmentId, field, value) => {
    setBeats(prev => prev.map(item =>
      isSegment(item) && item.id === segmentId ? { ...item, [field]: value } : item
    ));
  };

  const deleteSegment = (segmentId) => {
    setBeats(prev => prev.filter(item => !(isSegment(item) && item.id === segmentId)));
  };

  const dissolveSegment = (segmentId) => {
    setBeats(prev => {
      const result = [];
      for (const item of prev) {
        if (isSegment(item) && item.id === segmentId) {
          result.push(...item.children);
        } else {
          result.push(item);
        }
      }
      return result;
    });
  };

  const moveBeatToSegment = (beatId, targetSegmentId) => {
    setBeats(prev => {
      let movedBeat = null;
      // Remove beat from current location
      const withoutBeat = prev.reduce((acc, item) => {
        if (isSegment(item)) {
          const child = item.children.find(b => b.id === beatId);
          if (child) {
            movedBeat = child;
            acc.push({ ...item, children: item.children.filter(b => b.id !== beatId) });
          } else {
            acc.push(item);
          }
        } else if (item.id === beatId) {
          movedBeat = item;
        } else {
          acc.push(item);
        }
        return acc;
      }, []);
      if (!movedBeat) return prev;
      // Add to target segment
      return withoutBeat.map(item =>
        isSegment(item) && item.id === targetSegmentId
          ? { ...item, children: [...item.children, movedBeat] }
          : item
      );
    });
  };

  const moveBeatToTopLevel = (beatId) => {
    setBeats(prev => {
      let movedBeat = null;
      const withoutBeat = prev.map(item => {
        if (!isSegment(item)) return item;
        const child = item.children.find(b => b.id === beatId);
        if (child) {
          movedBeat = child;
          return { ...item, children: item.children.filter(b => b.id !== beatId) };
        }
        return item;
      });
      if (!movedBeat) return prev;
      return [...withoutBeat, movedBeat];
    });
  };

  // ─── template operations ───────────────────────────────────────────────────
  const fetchTemplates = async () => {
    setTemplatesLoading(true);
    const { data, error } = await supabase
      .from('beat_sheet_templates')
      .select('id, name, beats, created_by, created_at')
      .order('created_at', { ascending: false });
    if (error) console.error('Fetch templates error:', error);
    setTemplates(data || []);
    setTemplatesLoading(false);
  };

  const saveAsTemplate = async () => {
    const name = window.prompt('Template name:');
    if (!name?.trim()) return;
    const { error } = await supabase.from('beat_sheet_templates').insert({
      name: name.trim(),
      beats,
      created_by: profile?.id || null,
    });
    if (error) { console.error('Save template error:', error); return; }
    setToast({ type: 'success', message: `Template "${name.trim()}" saved.` });
    fetchTemplates();
  };

  const loadTemplate = (template) => {
    const cloned = cloneBeatsFresh(template.beats || []);
    setBeats(prev => [...prev, ...cloned]);
    setShowTemplates(false);
    setToast({ type: 'success', message: `Template "${template.name}" loaded.` });
  };

  const renameTemplate = async (id, currentName) => {
    const next = window.prompt('Rename template:', currentName);
    if (next == null) return;
    const name = next.trim();
    if (!name || name === currentName) return;
    setTemplates(prev => prev.map(t => (t.id === id ? { ...t, name } : t)));
    const { error } = await supabase.from('beat_sheet_templates').update({ name }).eq('id', id);
    if (error) { console.error('Rename template error:', error); fetchTemplates(); }
  };

  const deleteTemplate = async (id, name) => {
    if (!(await confirm(`Delete template "${name}"?`))) return;
    const { error } = await supabase.from('beat_sheet_templates').delete().eq('id', id);
    if (error) { console.error('Delete template error:', error); return; }
    fetchTemplates();
  };

  // ─── drag end ──────────────────────────────────────────────────────────────
  // Beats and segments live in a single flat droppable so a beat can be dragged
  // freely into or out of a segment in one motion (nested droppables of the same
  // type aren't reliably supported by the dnd library). The flat drag result is
  // reconstructed back into the nested { beat | segment{children} } tree here.
  const handleDragEnd = (result) => {
    const { source, destination } = result;
    if (!destination) return;
    if (source.index === destination.index) return;

    setBeats(prev => {
      // Build the flat model in the exact order rows are rendered (segment
      // headers + visible beats; collapsed segments contribute only a header).
      const flat = [];
      for (const item of prev) {
        if (isSegment(item)) {
          flat.push({ kind: 'seg', id: item.id });
          if (!collapsedSegments.has(item.id)) {
            for (const child of item.children) flat.push({ kind: 'beat', id: child.id, segId: item.id });
          }
        } else {
          flat.push({ kind: 'beat', id: item.id, segId: null });
        }
      }

      const s = source.index;
      const d = destination.index;
      if (s < 0 || s >= flat.length) return prev;
      const moved = flat[s];

      let newFlat;
      if (moved.kind === 'seg') {
        // Move the whole segment (header + its visible children) as one block.
        let end = s + 1;
        while (end < flat.length && flat[end].kind === 'beat' && flat[end].segId === moved.id) end++;
        const block = flat.slice(s, end);
        const rest = [...flat.slice(0, s), ...flat.slice(end)];
        let insertAt = d > s ? d - (block.length - 1) : d;
        insertAt = Math.max(0, Math.min(insertAt, rest.length));
        newFlat = [...rest.slice(0, insertAt), ...block, ...rest.slice(insertAt)];
      } else {
        // Move a single beat; its new segment membership is inherited from the
        // row it now sits under (a segment header → that segment; a beat → its
        // group; nothing above → top level / ungrouped).
        const rest = [...flat.slice(0, s), ...flat.slice(s + 1)];
        const insertAt = Math.max(0, Math.min(d, rest.length));
        const before = rest[insertAt - 1];
        const segId = before ? (before.kind === 'seg' ? before.id : before.segId) : null;
        newFlat = [...rest.slice(0, insertAt), { ...moved, segId }, ...rest.slice(insertAt)];
      }

      // Reconstruct the nested tree from the reordered flat list.
      const oldSegById = {};
      const beatById = {};
      for (const item of prev) {
        if (isSegment(item)) {
          oldSegById[item.id] = item;
          for (const c of item.children) beatById[c.id] = c;
        } else {
          beatById[item.id] = item;
        }
      }
      const rebuilt = [];
      const segNodeById = {};
      for (const e of newFlat) {
        if (e.kind === 'seg') {
          const base = oldSegById[e.id];
          if (!base) continue;
          const node = { ...base, children: [] };
          segNodeById[e.id] = node;
          rebuilt.push(node);
          // Collapsed segments keep their (unrendered) children from the old tree.
          if (collapsedSegments.has(e.id) && base.children) node.children.push(...base.children);
        } else {
          const beat = beatById[e.id];
          if (!beat) continue;
          if (e.segId && segNodeById[e.segId]) segNodeById[e.segId].children.push(beat);
          else rebuilt.push(beat);
        }
      }
      return rebuilt;
    });

    // Re-trigger auto-resize on textareas after React re-renders the moved beat
    requestAnimationFrame(() => {
      document.querySelectorAll('[data-autoresize]').forEach(autoResize);
    });
  };

  // ─── Google Drive folder browser (push target — unrelated to type grouping) ──
  const driveRootId = useRef(null);

  const loadFolders = async (parentId) => {
    setFoldersLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const params = parentId ? `?parentId=${encodeURIComponent(parentId)}` : '';
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/google-drive-folders${params}`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      });
      if (!resp.ok) throw new Error(await resp.text());
      const data = await resp.json();
      setFolders(data.folders || []);
      if (data.rootId) driveRootId.current = data.rootId;
    } catch (err) {
      console.error('Load folders error:', err);
      setFolders([]);
    }
    setFoldersLoading(false);
  };

  // Set when Actions › Push Beat Sheet needs a folder first: the very next
  // selectFolder pushes immediately. Cancelling the browser clears it.
  const pushAfterSelectRef = useRef(false);

  const openFolderBrowser = () => {
    setShowFolderBrowser(true);
    setFolderStack([]);
    setNewFolderName('');
    loadFolders(null);
  };

  const cancelFolderBrowser = () => {
    pushAfterSelectRef.current = false;
    setShowFolderBrowser(false);
  };

  // Actions › Push Beat Sheet: a saved folder pushes right away; otherwise
  // the folder picker opens and the pick itself triggers the push.
  const handlePushBeatSheetAction = () => {
    setActionsMenu(null);
    if (driveFolderId) {
      pushBeatSheet();
      return;
    }
    pushAfterSelectRef.current = true;
    openFolderBrowser();
  };

  const navigateToFolder = (folderId, folderName) => {
    setFolderStack(prev => [...prev, { id: folderId, name: folderName }]);
    loadFolders(folderId);
  };

  const navigateBack = () => {
    const newStack = folderStack.slice(0, -1);
    setFolderStack(newStack);
    const parentId = newStack.length > 0 ? newStack[newStack.length - 1].id : null;
    loadFolders(parentId);
  };

  const selectFolder = () => {
    let id;
    if (folderStack.length === 0) {
      // Selecting the root folder itself
      if (!driveRootId.current) return;
      id = driveRootId.current;
      setDriveFolderId(id);
      setDriveFolderName('Long Form');
    } else {
      const current = folderStack[folderStack.length - 1];
      id = current.id;
      setDriveFolderId(id);
      setDriveFolderName(folderStack.map(f => f.name).join(' / '));
    }
    setShowFolderBrowser(false);
    // Actions › Push Beat Sheet with no folder saved yet: the pick IS the
    // push — the chosen folder persists with the sheet via autosave.
    if (pushAfterSelectRef.current) {
      pushAfterSelectRef.current = false;
      pushBeatSheet(id);
    }
  };

  const createFolder = async () => {
    if (!newFolderName.trim()) return;
    const parentId = folderStack.length > 0 ? folderStack[folderStack.length - 1].id : null;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/google-drive-folders`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ parentId, name: newFolderName.trim() }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      setNewFolderName('');
      loadFolders(parentId);
    } catch (err) {
      console.error('Create folder error:', err);
    }
  };

  // ─── push actions ───────────────────────────────────────────────────────────
  const pushBeatSheet = async (folderIdOverride) => {
    const folderId = typeof folderIdOverride === 'string' ? folderIdOverride : driveFolderId;
    if (!folderId) {
      setToast({ type: 'error', message: 'Select a Google Drive folder first.' });
      return;
    }
    setPushingSheet(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/google-drive-create-sheet`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ folderId, title, beats: flattenBeats(beats) }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const data = await resp.json();
      setToast({ type: 'success', message: 'Beat sheet pushed to Drive!', url: data.sheetUrl });
    } catch (err) {
      console.error('Push beat sheet error:', err);
      setToast({ type: 'error', message: 'Failed to push beat sheet.' });
    }
    setPushingSheet(false);
  };

  const pushScript = async () => {
    if (!profile?.id) return;
    setPushingScript(true);
    try {
      const textToHtml = (text) => {
        if (!text?.trim()) return '';
        const lines = text.split('\n');
        let html = '';
        let inList = false;
        for (const line of lines) {
          const m = line.match(/^(\s*)[•\-]\s(.*)$/);
          if (m) {
            if (!inList) { html += '<ul>'; inList = true; }
            html += `<li>${m[2]}</li>`;
          } else {
            if (inList) { html += '</ul>'; inList = false; }
            if (line.trim()) html += `<p>${line}</p>`;
            else html += '<br>';
          }
        }
        if (inList) html += '</ul>';
        return html;
      };

      const graphicsCueStyle = 'color:#facc15; font-size:0.7em; font-weight:600; letter-spacing:0.08em; text-transform:uppercase; margin:0.3em 0;';
      const videoCueStyle = 'color:#38bdf8; font-size:0.7em; font-weight:600; letter-spacing:0.08em; text-transform:uppercase; margin:0.3em 0;';
      const divider = '<div style="border-top:1px solid rgba(255,255,255,0.12); margin:1.8em 0;"></div>';

      // Build HTML: graphics cues, beat content (no context), video cues
      const htmlParts = flattenBeats(beats)
        .filter(b => b.title.trim())
        .map(b => {
          const parts = [];
          if (b.graphics?.length > 0)
            parts.push(`<p style="${graphicsCueStyle}">${b.graphics.map(g => `[ ${g} ]`).join('  ')}</p>`);
          parts.push(textToHtml(b.title));
          if (b.videos?.length > 0)
            parts.push(`<p style="${videoCueStyle}">${b.videos.map(v => typeof v === 'object' ? `[ ${v.title || v.name || ''} ]` : `[ ${v} ]`).join('  ')}</p>`);
          return parts.join('');
        });
      const htmlContent = htmlParts.join(divider);

      // Upsert by name — delete existing with same name first, then insert
      await supabase
        .from('teleprompter_scripts')
        .delete()
        .eq('user_id', profile.id)
        .eq('name', title);

      const { error } = await supabase.from('teleprompter_scripts').insert({
        user_id: profile.id,
        name: title,
        content: htmlContent,
      });
      if (error) throw error;
      setToast({ type: 'success', message: 'Script pushed to Teleprompter!' });
    } catch (err) {
      console.error('Push script error:', err);
      setToast({ type: 'error', message: 'Failed to push script.' });
    }
    setPushingScript(false);
  };

  // ─── renderBeatRow (reused for top-level + segment-internal) ────────────────
  const renderBeatRow = (beat, provided, snapshot, parentSegmentId) => {
    const row = (
    <div
      ref={provided.innerRef}
      {...provided.draggableProps}
      onContextMenu={e => {
        const tag = e.target.tagName;
        if (tag === 'TEXTAREA' || tag === 'INPUT') return; // let browser show native menu (copy/paste/undo/spelling)
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, beatId: beat.id, segmentId: parentSegmentId });
      }}
      style={{
        ...styles.beatRow,
        ...(snapshot.isDragging ? { boxShadow: '0 8px 32px rgba(91, 143, 199,0.25)', border: '1px solid rgba(91, 143, 199,0.3)' } : {}),
        ...provided.draggableProps.style,
      }}
    >
      {/* Drag handle */}
      <div {...provided.dragHandleProps} style={styles.dragHandle} title="Drag to reorder">
        <svg width="12" height="16" viewBox="0 0 12 16" fill="rgba(255,255,255,0.25)">
          <circle cx="3" cy="2" r="1.5" /><circle cx="9" cy="2" r="1.5" />
          <circle cx="3" cy="6" r="1.5" /><circle cx="9" cy="6" r="1.5" />
          <circle cx="3" cy="10" r="1.5" /><circle cx="9" cy="10" r="1.5" />
          <circle cx="3" cy="14" r="1.5" /><circle cx="9" cy="14" r="1.5" />
        </svg>
      </div>

      {/* Col 1: Beat + Context */}
      <div style={styles.beatCol}>
        <textarea
          value={beat.title}
          onChange={e => { updateBeat(beat.id, 'title', e.target.value); autoResize(e.target); }}
          onKeyDown={e => handleBulletKeyDown(e, beat.id, 'title')}
          data-autoresize="true"
          placeholder="Beat..."
          rows={1}
          style={styles.beatInput}
        />
        {expandedContexts.has(beat.id) ? (
          <textarea
            value={beat.context}
            onChange={e => { updateBeat(beat.id, 'context', e.target.value); autoResize(e.target); }}
            onKeyDown={e => handleBulletKeyDown(e, beat.id, 'context')}
            data-autoresize="true"
            placeholder="Context... (type • or - for bullets)"
            rows={1}
            style={styles.contextInput}
          />
        ) : (
          <button
            onClick={() => setExpandedContexts(prev => new Set([...prev, beat.id]))}
            style={styles.addContextBtn}
          >
            + Context
          </button>
        )}
      </div>

      {/* Col 2: Graphics */}
      <div
        style={{
          ...styles.tagCol,
          ...(dropHighlight === `${beat.id}-graphics` ? styles.tagColDrop : {}),
        }}
        onDragOver={e => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            setDropHighlight(`${beat.id}-graphics`);
          } else if (tagDragRef.current?.field === 'graphics' && tagDragRef.current?.beatId !== beat.id) {
            e.preventDefault();
            setDropHighlight(`${beat.id}-graphics`);
          }
        }}
        onDragLeave={e => {
          if (!e.currentTarget.contains(e.relatedTarget)) setDropHighlight(null);
        }}
        onDrop={e => {
          setDropHighlight(null);
          if (e.dataTransfer.files.length > 0) {
            e.preventDefault();
            Array.from(e.dataTransfer.files).forEach(f => {
              if (f.type.startsWith('image/') || f.type.startsWith('video/')) {
                uploadBeatMedia(beat.id, 'graphics', f);
              }
            });
          } else {
            const d = tagDragRef.current;
            if (d && d.field === 'graphics' && d.beatId !== beat.id) {
              e.preventDefault();
              moveTagAcrossBeats(d.beatId, d.field, d.fromIndex, beat.id);
              tagDragRef.current = null;
            }
          }
        }}
      >
        {beat.graphics.map((g, i) => {
          const isMediaItem = typeof g === 'object' && g.url;
          if (isMediaItem) {
            return (
              <div key={g.id || g.url || `g${i}`} style={styles.mediaThumb}>
                {g.type === 'image'
                  ? <img src={g.url} alt={g.name} style={styles.mediaImg} />
                  : (
                    <div style={styles.mediaVideoIcon}>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="rgba(165,180,252,0.7)" strokeWidth="1.5">
                        <rect x="1" y="3" width="10" height="10" rx="1.5" />
                        <path d="M11 6l4-2v8l-4-2V6z" />
                      </svg>
                    </div>
                  )}
                <span style={styles.mediaName}>{g.name}</span>
                <button onClick={() => removeTag(beat.id, 'graphics', i)} style={styles.tagRemove}>&times;</button>
              </div>
            );
          }
          if (editingTag && editingTag.beatId === beat.id && editingTag.field === 'graphics' && editingTag.index === i) {
            return (
              <input
                key={`edit-g${i}`}
                autoFocus
                value={editingTag.value}
                onChange={e => setEditingTag(prev => ({ ...prev, value: e.target.value }))}
                onKeyDown={e => {
                  if (e.key === 'Enter') { renameTag(beat.id, 'graphics', i, editingTag.value); setEditingTag(null); }
                  if (e.key === 'Escape') setEditingTag(null);
                }}
                onBlur={() => setEditingTag(null)}
                style={styles.tagEditInput}
              />
            );
          }
          return (
            <span
              key={`${g}-${i}`}
              style={{ ...styles.tag, cursor: 'grab', ...(tagDone(beat.id, 'graphics', g) ? styles.tagDone : {}) }}
              draggable
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setContextMenu({
                  x: e.clientX, y: e.clientY, beatId: beat.id, segmentId: parentSegmentId,
                  tag: { key: `${beat.id}::graphics::${g}`, done: tagDone(beat.id, 'graphics', g), field: 'graphics', index: i, value: g },
                });
              }}
              onDragStart={() => { tagDragRef.current = { beatId: beat.id, field: 'graphics', fromIndex: i }; }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const d = tagDragRef.current;
                if (!d || d.beatId !== beat.id || d.field !== 'graphics' || d.fromIndex === i) return;
                reorderTag(d.beatId, d.field, d.fromIndex, i);
                tagDragRef.current = null;
              }}
            >
              <span style={styles.tagText}>{g}</span>
              <button onClick={() => removeTag(beat.id, 'graphics', i)} style={styles.tagRemove}>&times;</button>
            </span>
          );
        })}
        {uploadingCells[`${beat.id}-graphics`] && (
          <div style={styles.uploadingIndicator}>Uploading...</div>
        )}
        <input
          value={tagInputs[`${beat.id}-graphics`] || ''}
          onChange={e => setTagInputs(prev => ({ ...prev, [`${beat.id}-graphics`]: e.target.value }))}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              addTag(beat.id, 'graphics', e.target.value);
              setTagInputs(prev => ({ ...prev, [`${beat.id}-graphics`]: '' }));
            }
          }}
          placeholder="+ add graphic"
          style={styles.tagInput}
        />
      </div>

      {/* Col 3: Videos */}
      <div
        style={{
          ...styles.tagCol,
          ...(dropHighlight === `${beat.id}-videos` ? styles.tagColDrop : {}),
        }}
        onDragOver={e => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            setDropHighlight(`${beat.id}-videos`);
          } else if (tagDragRef.current?.field === 'videos' && tagDragRef.current?.beatId !== beat.id) {
            e.preventDefault();
            setDropHighlight(`${beat.id}-videos`);
          }
        }}
        onDragLeave={e => {
          if (!e.currentTarget.contains(e.relatedTarget)) setDropHighlight(null);
        }}
        onDrop={e => {
          setDropHighlight(null);
          if (e.dataTransfer.files.length > 0) {
            e.preventDefault();
            Array.from(e.dataTransfer.files).forEach(f => {
              if (f.type.startsWith('image/') || f.type.startsWith('video/')) {
                uploadBeatMedia(beat.id, 'videos', f);
              }
            });
          } else {
            const d = tagDragRef.current;
            if (d && d.field === 'videos' && d.beatId !== beat.id) {
              e.preventDefault();
              moveTagAcrossBeats(d.beatId, d.field, d.fromIndex, beat.id);
              tagDragRef.current = null;
            }
          }
        }}
      >
        {beat.videos.map((v, i) => {
          const isMediaItem = typeof v === 'object' && v.url;
          if (isMediaItem) {
            return (
              <div key={v.id || v.url || `v${i}`} style={styles.mediaThumb}>
                {v.type === 'image'
                  ? <img src={v.url} alt={v.name} style={styles.mediaImg} />
                  : (
                    <div style={styles.mediaVideoIcon}>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="rgba(165,180,252,0.7)" strokeWidth="1.5">
                        <rect x="1" y="3" width="10" height="10" rx="1.5" />
                        <path d="M11 6l4-2v8l-4-2V6z" />
                      </svg>
                    </div>
                  )}
                <span style={styles.mediaName}>{v.name}</span>
                <button onClick={() => removeTag(beat.id, 'videos', i)} style={styles.tagRemove}>&times;</button>
              </div>
            );
          }
          if (editingTag && editingTag.beatId === beat.id && editingTag.field === 'videos' && editingTag.index === i) {
            return (
              <input
                key={`edit-v${i}`}
                autoFocus
                value={editingTag.value}
                onChange={e => setEditingTag(prev => ({ ...prev, value: e.target.value }))}
                onKeyDown={e => {
                  if (e.key === 'Enter') { renameTag(beat.id, 'videos', i, editingTag.value); setEditingTag(null); }
                  if (e.key === 'Escape') setEditingTag(null);
                }}
                onBlur={() => setEditingTag(null)}
                style={styles.tagEditInput}
              />
            );
          }
          return (
            <span
              key={`${v}-${i}`}
              style={{ ...styles.tag, cursor: 'grab', ...(tagDone(beat.id, 'videos', v) ? styles.tagDone : {}) }}
              draggable
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setContextMenu({
                  x: e.clientX, y: e.clientY, beatId: beat.id, segmentId: parentSegmentId,
                  tag: { key: `${beat.id}::videos::${v}`, done: tagDone(beat.id, 'videos', v), field: 'videos', index: i, value: v },
                });
              }}
              onDragStart={() => { tagDragRef.current = { beatId: beat.id, field: 'videos', fromIndex: i }; }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const d = tagDragRef.current;
                if (!d || d.beatId !== beat.id || d.field !== 'videos' || d.fromIndex === i) return;
                reorderTag(d.beatId, d.field, d.fromIndex, i);
                tagDragRef.current = null;
              }}
            >
              <span style={styles.tagText}>{v}</span>
              <button onClick={() => removeTag(beat.id, 'videos', i)} style={styles.tagRemove}>&times;</button>
            </span>
          );
        })}
        {uploadingCells[`${beat.id}-videos`] && (
          <div style={styles.uploadingIndicator}>Uploading...</div>
        )}
        <input
          value={tagInputs[`${beat.id}-videos`] || ''}
          onChange={e => setTagInputs(prev => ({ ...prev, [`${beat.id}-videos`]: e.target.value }))}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              addTag(beat.id, 'videos', e.target.value);
              setTagInputs(prev => ({ ...prev, [`${beat.id}-videos`]: '' }));
            }
          }}
          placeholder="+ add video"
          style={styles.tagInput}
        />
      </div>

      {/* Col 4: Notes */}
      <div style={styles.notesCol}>
        <textarea
          value={beat.notes || ''}
          onChange={e => { updateBeat(beat.id, 'notes', e.target.value); autoResize(e.target); }}
          data-autoresize="true"
          placeholder="Notes..."
          rows={1}
          style={styles.notesInput}
        />
      </div>

      {/* Delete beat */}
      <button onClick={() => deleteBeat(beat.id)} style={styles.deleteBeatBtn} title="Delete beat">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M2 4h10M5 4V2.5a.5.5 0 01.5-.5h3a.5.5 0 01.5.5V4M11 4v7.5a1 1 0 01-1 1H4a1 1 0 01-1-1V4" />
        </svg>
      </button>
    </div>
    );
    return snapshot.isDragging ? ReactDOM.createPortal(row, document.body) : row;
  };

  // ─── render ─────────────────────────────────────────────────────────────────

  // ── toast ──
  const renderToast = () => {
    if (!toast) return null;
    return (
      <div style={{
        position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
        padding: '12px 20px', borderRadius: 8,
        background: toast.type === 'success' ? '#22c55e' : '#ef4444',
        color: '#fff', fontSize: 14, fontWeight: 500,
        display: 'flex', alignItems: 'center', gap: 10,
        boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
      }}>
        <span>{toast.message}</span>
        {toast.url && (
          <a href={toast.url} target="_blank" rel="noreferrer" style={{
            color: '#fff', textDecoration: 'underline', fontWeight: 600,
          }}>Open</a>
        )}
      </div>
    );
  };

  // ── version history modal ──
  const renderVersionHistory = () => {
    if (!showVersionHistory) return null;
    return (
      <div style={styles.modalOverlay} onMouseDown={(e) => { if (e.target === e.currentTarget) { setShowVersionHistory(false); setPreviewVersion(null); } }}>
        <div style={{ ...styles.modal, width: previewVersion ? 820 : 480, display: 'flex', flexDirection: 'column', maxHeight: '80vh' }} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ margin: 0, color: 'rgba(255,255,255,0.9)', fontSize: 16 }}>Version History</h3>
            <button onClick={() => { setShowVersionHistory(false); setPreviewVersion(null); }} style={styles.iconBtn}>&times;</button>
          </div>

          <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>
            {/* Version list */}
            <div style={{ width: previewVersion ? 260 : '100%', overflowY: 'auto', flexShrink: 0 }}>
              {versionsLoading ? (
                <div style={{ padding: 20, textAlign: 'center', color: 'rgba(255,255,255,0.4)' }}>Loading...</div>
              ) : versions.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', color: 'rgba(255,255,255,0.4)' }}>No versions yet</div>
              ) : versions.map(v => (
                <div
                  key={v.id}
                  onClick={() => previewVersionData(v.id)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    background: previewVersion?.id === v.id ? 'rgba(91, 143, 199,0.15)' : 'rgba(255,255,255,0.03)',
                    border: previewVersion?.id === v.id ? '1px solid rgba(91, 143, 199,0.3)' : '1px solid transparent',
                    marginBottom: 6,
                  }}
                >
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)', fontWeight: 500 }}>
                    {new Date(v.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    {' \u00b7 '}
                    {new Date(v.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  </div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
                    {v.beat_count} beat{v.beat_count !== 1 ? 's' : ''}
                    {v.title ? ` \u00b7 ${v.title}` : ''}
                  </div>
                </div>
              ))}
            </div>

            {/* Preview panel */}
            {previewVersion && (
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', borderLeft: '1px solid rgba(255,255,255,0.08)', paddingLeft: 16 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.8)', marginBottom: 8 }}>
                  {previewVersion.title}
                </div>
                <div style={{ flex: 1, overflowY: 'auto', marginBottom: 12 }}>
                  {(previewVersion.beats || []).map((item, i) => {
                    if (isSegment(item)) {
                      return (
                        <div key={item.id || i} style={{ background: `${item.color || '#5b8fc7'}12`, border: `1px solid ${item.color || '#5b8fc7'}30`, borderLeft: `3px solid ${item.color || '#5b8fc7'}`, borderRadius: 6, paddingLeft: 8, paddingTop: 6, paddingBottom: 4, marginBottom: 6 }}> // style-lint-ignore
                          <div style={{ fontSize: 12, fontWeight: 600, color: item.color || '#5b8fc7', marginBottom: 4 }}>
                            {item.title || '(untitled segment)'}
                          </div>
                          {(item.children || []).map((beat, j) => (
                            <div key={beat.id || j} style={{ padding: '6px 8px', background: 'rgba(255,255,255,0.03)', borderRadius: 6, marginBottom: 3 }}>
                              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)', fontWeight: 500 }}>{beat.title || '(empty beat)'}</div>
                              {beat.context && <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 3, whiteSpace: 'pre-wrap' }}>{beat.context}</div>}
                            </div>
                          ))}
                        </div>
                      );
                    }
                    const beat = item;
                    return (
                      <div key={beat.id || i} style={{ padding: '8px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: 6, marginBottom: 4 }}>
                        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)', fontWeight: 500 }}>
                          {beat.title || '(empty beat)'}
                        </div>
                        {beat.context && (
                          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 4, whiteSpace: 'pre-wrap' }}>
                            {beat.context}
                          </div>
                        )}
                        {((beat.graphics && beat.graphics.length > 0) || (beat.videos && beat.videos.length > 0)) && (
                          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 4 }}>
                            {beat.graphics?.length ? `${beat.graphics.length} graphic${beat.graphics.length !== 1 ? 's' : ''}` : ''}
                            {beat.graphics?.length && beat.videos?.length ? ' \u00b7 ' : ''}
                            {beat.videos?.length ? `${beat.videos.length} video${beat.videos.length !== 1 ? 's' : ''}` : ''}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <button
                  onClick={() => restoreVersion(previewVersion)}
                  style={styles.btnPrimary}
                >
                  Restore This Version
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ── folder browser modal ──
  const renderFolderBrowser = () => {
    if (!showFolderBrowser) return null;
    const currentPath = folderStack.map(f => f.name).join(' / ') || 'Long Form';
    return (
      <div style={styles.modalOverlay} onMouseDown={(e) => { if (e.target === e.currentTarget) cancelFolderBrowser(); }}>
        <div style={styles.modal} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ margin: 0, color: 'rgba(255,255,255,0.9)', fontSize: 16 }}>Select Drive Folder</h3>
            <button onClick={cancelFolderBrowser} style={styles.iconBtn}>&times;</button>
          </div>

          {/* Breadcrumb */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            <button
              onClick={() => { setFolderStack([]); loadFolders(null); }}
              style={{ ...styles.breadcrumb, fontWeight: folderStack.length === 0 ? 600 : 400 }}
            >Long Form</button>
            {folderStack.map((f, i) => (
              <React.Fragment key={f.id}>
                <span style={{ color: 'rgba(255,255,255,0.3)' }}>/</span>
                <button
                  onClick={() => {
                    const newStack = folderStack.slice(0, i + 1);
                    setFolderStack(newStack);
                    loadFolders(f.id);
                  }}
                  style={{ ...styles.breadcrumb, fontWeight: i === folderStack.length - 1 ? 600 : 400 }}
                >{f.name}</button>
              </React.Fragment>
            ))}
          </div>

          {/* Folder list */}
          <div style={{ minHeight: 200, maxHeight: 300, overflowY: 'auto', marginBottom: 12 }}>
            {folderStack.length > 0 && (
              <button type="button" onClick={navigateBack} style={{ ...buttonReset, ...styles.folderRow }}>
                <span style={{ fontSize: 16 }}>&#8592;</span>
                <span>Back</span>
              </button>
            )}
            {foldersLoading ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'rgba(255,255,255,0.4)' }}>Loading...</div>
            ) : folders.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'rgba(255,255,255,0.4)' }}>No folders here</div>
            ) : folders.map(f => (
              <button type="button" key={f.id} onClick={() => navigateToFolder(f.id, f.name)} style={{ ...buttonReset, ...styles.folderRow }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="#f59e0b" stroke="none">
                  <path d="M1 3.5A1.5 1.5 0 012.5 2h3.379a1.5 1.5 0 011.06.44l.622.62a1.5 1.5 0 001.06.44H13.5A1.5 1.5 0 0115 5v7.5a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 011 12.5v-9z"/>
                </svg>
                <span>{f.name}</span>
              </button>
            ))}
          </div>

          {/* New folder */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <input
              value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && createFolder()}
              placeholder="New folder name..."
              style={styles.input}
            />
            <button onClick={createFolder} style={styles.btnSmall}>Create</button>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button onClick={cancelFolderBrowser} style={styles.btnSecondary}>Cancel</button>
            <button
              onClick={selectFolder}
              style={styles.btnPrimary}
            >Select This Folder</button>
          </div>
        </div>
      </div>
    );
  };

  // ── create-sheet modal (blank or from template) ──
  const renderCreateModal = () => {
    if (!showCreateModal) return null;
    return (
      <div style={styles.modalOverlay} onMouseDown={(e) => { if (e.target === e.currentTarget) setShowCreateModal(false); }}>
        <div style={styles.modal} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ margin: 0, color: 'rgba(255,255,255,0.9)', fontSize: 16 }}>New Beat Sheet</h3>
            <button onClick={() => setShowCreateModal(false)} style={styles.iconBtn}>&times;</button>
          </div>

          <label style={styles.createLabel}>Name</label>
          <input
            autoFocus
            value={createName}
            onChange={e => setCreateName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') confirmCreate(); }}
            placeholder="Beat sheet name..."
            style={{ ...styles.input, width: '100%', boxSizing: 'border-box', marginBottom: 16 }}
          />

          <label style={styles.createLabel}>Tag</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
            {tags.map(t => {
              const active = createTagId === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setCreateTagId(t.id)}
                  style={{
                    padding: '4px 12px', borderRadius: 999, cursor: 'pointer',
                    fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
                    background: active ? `${t.color}26` : 'rgba(255,255,255,0.04)',
                    color: active ? t.color : 'rgba(255,255,255,0.55)',
                    border: `1px solid ${active ? `${t.color}66` : 'rgba(255,255,255,0.1)'}`,
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          <label style={styles.createLabel}>Start from Template</label>
          <div style={styles.createOptionList}>
            <button
              onClick={() => setCreateTemplateId(null)}
              style={{ ...styles.createOption, ...(createTemplateId === null ? styles.createOptionActive : {}) }}
            >
              <span style={styles.createRadio(createTemplateId === null)} />
              <span style={{ flex: 1 }}>Blank</span>
            </button>
            {templatesLoading ? (
              <div style={{ padding: '8px 12px', fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Loading templates...</div>
            ) : templates.map(t => (
              <button
                key={t.id}
                onClick={() => setCreateTemplateId(t.id)}
                style={{ ...styles.createOption, ...(createTemplateId === t.id ? styles.createOptionActive : {}) }}
              >
                <span style={styles.createRadio(createTemplateId === t.id)} />
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', flexShrink: 0 }}>{countBeats(t.beats || [])} beats</span>
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
            <button onClick={() => setShowCreateModal(false)} style={styles.btnSecondary}>Cancel</button>
            <button
              onClick={confirmCreate}
              disabled={!createName.trim() || !createTagId || createBusy}
              title={createTagId ? undefined : 'Pick a tag — it decides where the sheet goes'}
              style={{ ...styles.btnPrimary, opacity: !createName.trim() || !createTagId || createBusy ? 0.5 : 1, cursor: !createName.trim() || !createTagId || createBusy ? 'default' : 'pointer' }}
            >
              {createBusy ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ── landing page ──
  if (!activeSheet) {
    const bySection = groupedSheets;

    const renderTagCell = (sheet) => {
      const mine = tagsForSheet(sheet);
      return (
        <div style={styles.tagCell}>
          {mine.map(t => (
            <span key={t.id} style={{ ...styles.tagChip, background: `${t.color}22`, color: t.color, borderColor: `${t.color}55` }}>
              {t.label}
            </span>
          ))}
          <button
            type="button"
            style={styles.tagAddBtn}
            title="Edit tags"
            onClick={(e) => { e.stopPropagation(); setTagEditorId(prev => (prev === sheet.id ? null : sheet.id)); }}
          >
            {mine.length ? '+' : 'Add tag'}
          </button>
          {tagEditorId === sheet.id && (
            <TagEditor
              tags={tags}
              selected={sheet.tag_ids || []}
              onToggle={(tagId) => toggleSheetTag(sheet, tagId)}
              onCreate={(label) => createTagFor(sheet, label)}
              onClose={() => setTagEditorId(null)}
            />
          )}
        </div>
      );
    };

    const renderSheetRow = (sheet, index) => {
      const renaming = renamingSheetId === sheet.id;
      const n = countBeats(sheet.beats || []);
      return (
        <Draggable draggableId={sheet.id} index={index} key={sheet.id} isDragDisabled={!!sort}>
          {(dp, snap) => (
            <div
              ref={dp.innerRef}
              {...dp.draggableProps}
              style={{
                ...styles.tableRow,
                ...(snap.isDragging ? styles.tableRowDragging : {}),
                ...dp.draggableProps.style,
              }}
              onContextMenu={(e) => openCtx(e, sheet)}
            >
              <span {...dp.dragHandleProps} style={styles.dragHandle} title="Drag to move between sections">⋮⋮</span>

              {renaming ? (
                <input
                  autoFocus
                  value={renameSheetValue}
                  onChange={(e) => setRenameSheetValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitRename(sheet.id); if (e.key === 'Escape') setRenamingSheetId(null); }}
                  onBlur={() => commitRename(sheet.id)}
                  style={styles.rowRenameInput}
                />
              ) : (
                <button type="button" style={{ ...buttonReset, ...styles.cellTitle }} onClick={() => openSheet(sheet)}>
                  {sheet.title || 'Untitled'}
                </button>
              )}

              {renderTagCell(sheet)}

              <span style={styles.cellNum}>{n}</span>
              <span style={styles.cellDate} title={fullTimestamp(sheet.created_at)}>{shortDate(sheet.created_at)}</span>
              <span style={styles.cellDate} title={fullTimestamp(sheet.updated_at)}>{timeAgo(sheet.updated_at)}</span>
              <span style={styles.cellWho} title={creatorName(sheet.user_id)}>{creatorName(sheet.user_id)}</span>
              {(() => {
                const st = STATUS_BY_VALUE[sheet.status] || STATUS_BY_VALUE.drafting;
                return (
                  <span style={{ ...styles.statusPill, color: st.color, borderColor: `${st.color}55`, background: `${st.color}18` }}>
                    {st.label}
                  </span>
                );
              })()}
            </div>
          )}
        </Draggable>
      );
    };

    const renderSection = ({ key, label }) => {
      const rows = bySection[key] || [];
      const collapsed = collapsedSections.has(key);
      return (
        <section key={key} style={styles.section}>
          <button style={styles.sectionHeaderBtn} onClick={() => toggleSection(key)}>
            <svg
              width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"
              style={{ color: colors.textSubtle, transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.15s', flexShrink: 0 }}
            >
              <path d="M2 3.5l3 3 3-3" />
            </svg>
            <span style={styles.sectionTitle}>{label}</span>
            <span style={styles.sectionCount}>{rows.length}</span>
          </button>

          {!collapsed && (
            <>
              <div style={styles.theadRow}>
                <span />
                <SortableTh label="Title" k="title" sort={sort} onSort={onSort} />
                <SortableTh label="Tags" k="tags" sort={sort} onSort={onSort} />
                <SortableTh label="Beats" k="beats" sort={sort} onSort={onSort} />
                <SortableTh label="Created" k="created" sort={sort} onSort={onSort} />
                <SortableTh label="Updated" k="updated" sort={sort} onSort={onSort} />
                <SortableTh label="Created by" k="who" sort={sort} onSort={onSort} />
                <SortableTh label="Status" k="status" sort={sort} onSort={onSort} />
              </div>

              <Droppable droppableId={key}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    style={snapshot.isDraggingOver ? styles.sectionRowsOver : styles.sectionRows}
                  >
                    {rows.length === 0
                      ? <div style={styles.sectionEmpty}>
                          {key === 'active' ? 'Drag sheets here as you start working on them' : 'No beat sheets'}
                        </div>
                      : rows.map(renderSheetRow)}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </>
          )}
        </section>
      );
    };

    return (
      <div style={styles.page}>
        {renderCreateModal()}
        <div style={styles.header}>
          <h1 style={styles.pageTitle}>Beat Sheets</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: spacing.md }}>
            {sort && (
              <button onClick={() => setSort(null)} style={styles.clearSortBtn} title="Return to manual drag order">
                Clear sort
              </button>
            )}
            <button onClick={openCreateModal} style={styles.btnPrimary}>+ New Beat Sheet</button>
          </div>
        </div>

        {sort && (
          <div style={styles.sortNote}>
            Sorted by {sort.k} — dragging is off while sorted. Right-click a row to move it
            between sections, or clear the sort to drag.
          </div>
        )}

        {loading ? (
          <div style={styles.emptyState}>Loading...</div>
        ) : (
          <DragDropContext onDragEnd={onSheetDragEnd}>
            <div style={styles.sectionsWrap}>
              {SECTIONS.map(renderSection)}
            </div>
          </DragDropContext>
        )}

        {ctxMenu && (
          <>
            <div
              style={styles.ctxOverlay}
              onClick={closeCtx}
              onContextMenu={(e) => { e.preventDefault(); closeCtx(); }}
            />
            <div
              style={{
                ...styles.ctxMenu,
                top: Math.min(ctxMenu.y, (typeof window !== "undefined" ? window.innerHeight : 800) - 340),
                left: Math.min(ctxMenu.x, (typeof window !== "undefined" ? window.innerWidth : 1200) - 210),
              }}
            >
              <button style={styles.ctxItem} onClick={() => { startRename(ctxMenu.sheet); closeCtx(); }}>Edit title</button>
              <button style={styles.ctxItem} onClick={() => { duplicateSheet(ctxMenu.sheet); closeCtx(); }}>Duplicate</button>
              <div style={styles.ctxDivider} />
              <div style={styles.ctxLabel}>Move to</div>
              {SECTIONS.map(s => {
                const current = sectionOf(ctxMenu.sheet) === s.key;
                return (
                  <button
                    key={s.key}
                    style={{ ...styles.ctxItem, ...styles.ctxTypeItem, ...(current ? { color: colors.accentFg } : {}) }}
                    onClick={() => { if (!current) moveSheetToSection(ctxMenu.sheet, s.key); closeCtx(); }}
                  >
                    {current ? "✓ " : ""}{s.label}
                  </button>
                );
              })}
              <div style={styles.ctxDivider} />
              <button style={{ ...styles.ctxItem, color: colors.danger.fg }} onClick={() => { deleteSheet(ctxMenu.sheet.id, ctxMenu.sheet.title); closeCtx(); }}>Delete</button>
            </div>
          </>
        )}

        {renderToast()}
      </div>
    );
  }
  // ── editor page ──
  // ─── render: open sheet ─────────────────────────────────────────────────────
  // The beat rows are built once and then placed into whichever pane the
  // current view calls for, so Split doesn't need a second copy of the tree.
  const isSplitLayout = viewMode !== VIEW_BEATS;

  const beatSheetBody = (
    <>
    {/* Column headers */}
    <div style={styles.columnHeaders}>
      <div style={styles.colHeaderLeft}>Beat / Context</div>
      <div style={styles.colHeader}>Graphics</div>
      <div style={styles.colHeader}>Videos</div>
      <div style={styles.colHeader}>Notes</div>
      <div style={{ width: 36 }} />
    </div>

    {/* Add beat / segment (top) */}
    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8, position: 'relative' }}>
      <div style={{ width: '20%', minWidth: 120, position: 'relative' }}>
        <button onClick={() => setShowAddMenuTop(prev => !prev)} style={{ ...styles.addBeatBtn, width: '100%' }}>+ Add</button>
        {showAddMenuTop && (
          <div data-add-menu style={styles.addMenuDropdown}>
            <button style={styles.addMenuItem} onClick={() => { addBeatToTop(); setShowAddMenuTop(false); }}>Beat</button>
            <button style={styles.addMenuItem} onClick={() => { addSegmentToTop(); setShowAddMenuTop(false); }}>Segment</button>
          </div>
        )}
      </div>
    </div>

    {/* Beat rows */}
    <DragDropContext onDragEnd={handleDragEnd}>
      <Droppable droppableId="beat-list" type="ITEMS">
        {(provided) => {
          // Single flat droppable: segment headers and beats share one
          // contiguous index space so beats drag freely in/out of segments.
          let idx = 0;
          return (
          <div ref={provided.innerRef} {...provided.droppableProps}>
            {beats.map((item) => {
              if (isSegment(item)) {
                const collapsed = collapsedSegments.has(item.id);
                const headerIndex = idx++;
                return (
                  <div
                    key={item.id}
                    style={{
                      ...styles.segmentContainer,
                      background: `${item.color || '#5b8fc7'}12`,
                      border: `1px solid ${item.color || '#5b8fc7'}30`,
                      borderLeft: `4px solid ${item.color || '#5b8fc7'}`,
                    }}
                  >
                    {/* Segment header (draggable = moves the whole segment) */}
                    <Draggable draggableId={item.id} index={headerIndex}>
                      {(hProvided, hSnapshot) => (
                        <div
                          ref={hProvided.innerRef}
                          {...hProvided.draggableProps}
                          style={{
                            ...styles.segmentHeader,
                            ...(hSnapshot.isDragging ? { boxShadow: `0 8px 32px ${item.color || '#5b8fc7'}40`, borderRadius: 8, background: `${item.color || '#5b8fc7'}20` } : {}),
                            ...hProvided.draggableProps.style,
                          }}
                          onContextMenu={e => {
                            const tag = e.target.tagName;
                            if (tag === 'TEXTAREA' || tag === 'INPUT') return;
                            e.preventDefault();
                            setContextMenu({ x: e.clientX, y: e.clientY, segmentId: item.id, isSegmentHeader: true });
                          }}
                        >
                          <div {...hProvided.dragHandleProps} style={styles.dragHandle} title="Drag to reorder segment">
                            <svg width="12" height="16" viewBox="0 0 12 16" fill="rgba(255,255,255,0.25)">
                              <circle cx="3" cy="2" r="1.5" /><circle cx="9" cy="2" r="1.5" />
                              <circle cx="3" cy="6" r="1.5" /><circle cx="9" cy="6" r="1.5" />
                              <circle cx="3" cy="10" r="1.5" /><circle cx="9" cy="10" r="1.5" />
                              <circle cx="3" cy="14" r="1.5" /><circle cx="9" cy="14" r="1.5" />
                            </svg>
                          </div>
                          <button
                            onClick={() => setCollapsedSegments(prev => {
                              const next = new Set(prev);
                              const wasCollapsed = next.has(item.id);
                              wasCollapsed ? next.delete(item.id) : next.add(item.id);
                              if (wasCollapsed) requestAnimationFrame(() => document.querySelectorAll('[data-autoresize]').forEach(autoResize));
                              return next;
                            })}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', display: 'flex', alignItems: 'center', flexShrink: 0 }}
                            title={collapsed ? 'Expand segment' : 'Collapse segment'}
                          >
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={item.color || '#5b8fc7'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                              style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.15s ease' }}>
                              <path d="M4 5l3 3 3-3" />
                            </svg>
                          </button>
                          <input
                            value={item.title}
                            onChange={e => updateSegment(item.id, 'title', e.target.value)}
                            placeholder="Segment title..."
                            style={{ ...styles.segmentTitleInput, color: item.color || '#5b8fc7' }}
                          />
                          <div style={{ position: 'relative' }}>
                            <button
                              onClick={() => setShowColorDropdown(prev => prev === item.id ? null : item.id)}
                              style={{ ...styles.colorDot, background: item.color || '#5b8fc7', width: 20, height: 20, flexShrink: 0 }}
                              title="Change color"
                            />
                            {showColorDropdown === item.id && (
                              <div data-color-dropdown style={styles.colorDropdown}>
                                {SEGMENT_COLORS.map(c => (
                                  <button
                                    key={c}
                                    onClick={() => { updateSegment(item.id, 'color', c); setShowColorDropdown(null); }}
                                    style={{
                                      ...styles.colorDot,
                                      background: c,
                                      width: 22,
                                      height: 22,
                                      outline: item.color === c ? '2px solid rgba(255,255,255,0.6)' : 'none',
                                      outlineOffset: 2,
                                    }}
                                  />
                                ))}
                              </div>
                            )}
                          </div>
                          {collapsed && (
                            <span style={{ fontSize: fontSizes.sm, color: colors.textDim, marginLeft: 'auto', paddingRight: spacing.sm, flexShrink: 0 }}>
                              {item.children.length} beat{item.children.length !== 1 ? 's' : ''}
                            </span>
                          )}
                          <button onClick={() => deleteSegment(item.id)} style={styles.deleteBeatBtn} title="Delete segment">
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                              <path d="M2 4h10M5 4V2.5a.5.5 0 01.5-.5h3a.5.5 0 01.5.5V4M11 4v7.5a1 1 0 01-1 1H4a1 1 0 01-1-1V4" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </Draggable>

                    {/* Segment beats — draggables sharing the flat index space */}
                    {!collapsed && item.children.map((beat) => {
                      const beatIndex = idx++;
                      return (
                        <Draggable key={beat.id} draggableId={beat.id} index={beatIndex}>
                          {(bProvided, bSnapshot) => renderBeatRow(beat, bProvided, bSnapshot, item.id)}
                        </Draggable>
                      );
                    })}

                    {!collapsed && (
                      <button onClick={() => addBeatToSegment(item.id)} style={styles.addBeatInSegmentBtn}>+ Beat</button>
                    )}
                  </div>
                );
              }

              // Top-level beat
              const beat = item;
              const beatIndex = idx++;
              return (
                <Draggable key={beat.id} draggableId={beat.id} index={beatIndex}>
                  {(provided, snapshot) => renderBeatRow(beat, provided, snapshot, null)}
                </Draggable>
              );
            })}
            {provided.placeholder}
          </div>
          );
        }}
      </Droppable>
    </DragDropContext>

    {/* Add beat / segment (bottom) */}
    <div style={{ display: 'flex', justifyContent: 'center', marginTop: 4, position: 'relative' }}>
      <div style={{ width: '20%', minWidth: 120, position: 'relative' }}>
        <button onClick={() => setShowAddMenuBottom(prev => !prev)} style={{ ...styles.addBeatBtn, width: '100%' }}>+ Add</button>
        {showAddMenuBottom && (
          <div
            data-add-menu
            style={{
              ...styles.addMenuDropdown,
              bottom: '100%',
              top: 'auto',
              marginBottom: 6, // style-lint-ignore — mirrors addMenuDropdown's own 6px offset
              marginTop: 0,
            }}
          >
            <button style={styles.addMenuItem} onClick={() => { addBeat(); setShowAddMenuBottom(false); }}>Beat</button>
            <button style={styles.addMenuItem} onClick={() => { addSegment(); setShowAddMenuBottom(false); }}>Segment</button>
          </div>
        )}
      </div>
    </div>
    </>
  );

  const researchPane = researchError ? (
    <div style={styles.researchFallback}>
      <span style={{ fontWeight: fontWeights.semibold, color: colors.textMuted }}>Research document unavailable</span>
      <span style={{ fontSize: fontSizes.sm }}>{researchError}</span>
      <button
        style={styles.btnSecondary}
        onClick={() => { setResearchError(null); ensureResearchDoc(activeSheet.id); }}
      >
        Try again
      </button>
    </div>
  ) : !researchDoc ? (
    <div style={styles.researchFallback}>Opening research document…</div>
  ) : (
    <GDocsEditor
      key={researchDoc.id}
      docId={researchDoc.id}
      tableName={RESEARCH_TABLE}
      title={title}
      initialSummary={researchDoc.summary || ''}
      canManageTemplates={!!isAdmin}
      compact={viewMode === VIEW_SPLIT}
    />
  );

  // Pane order is CSS-only (flex `order`) and the hidden pane in Research view
  // is display:none rather than unmounted. Both keep the Tiptap instance alive
  // across Research → Split → Swap, so those switches don't refetch the
  // document or throw away its undo history.
  const beatPaneStyle = {
    ...styles.splitPane,
    order: splitSwapped ? 2 : 0,
    flexBasis: `${splitRatio * 100}%`,
    ...(viewMode === VIEW_RESEARCH ? { display: 'none' } : null),
  };
  const researchPaneStyle = {
    ...styles.splitPane,
    order: splitSwapped ? 0 : 2,
    flexBasis: viewMode === VIEW_RESEARCH ? '100%' : `${(1 - splitRatio) * 100}%`,
  };

  return (
    <div style={isSplitLayout ? { ...styles.page, ...styles.pageFullHeight } : styles.page}>
      {/* View toggle — its own centered row above everything else */}
      <div style={styles.viewSwitchRow} className="no-print">
        <button onClick={closeEditor} style={styles.viewSwitchRowBack} title="Back to list">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M11 4L6 9l5 5" />
          </svg>
        </button>
        <div style={styles.viewSwitch}>
          {VIEW_MODES.map(mode => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              style={{ ...styles.viewSwitchBtn, ...(viewMode === mode ? styles.viewSwitchBtnActive : null) }}
              title={`${VIEW_LABELS[mode]} view`}
            >
              {VIEW_LABELS[mode]}
            </button>
          ))}
        </div>
        <div style={{ position: 'absolute', right: 44, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={styles.saveIndicator}>
            {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'unsaved' ? 'Unsaved' : 'Saved'}
          </span>
          {lastSavedAt && (
            <span style={styles.updatedIndicator}>
              Updated {fullTimestamp(lastSavedAt)}
            </span>
          )}
        </div>
      </div>

      {/* Beat sheet toolbar — only when the beat sheet itself is on screen */}
      {viewMode !== VIEW_RESEARCH && (
      <div style={styles.configBar} className="no-print">
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Beat sheet title..."
          style={styles.titleInput}
        />

        {viewMode === VIEW_SPLIT && (
          <button onClick={toggleSplitSwap} style={styles.btnSecondary} title="Swap the two panes">
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              style={{ marginRight: 6 }} // style-lint-ignore — matches the sibling icon buttons in this bar
            >
              <path d="M2 4.5h8L8 2.5M12 9.5H4l2 2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Swap
          </button>
        )}

        {/* Tags replaced the single `type` select. Same place in the bar, but
            multi-select and shared with the landing table's vocabulary. */}
        <div style={styles.configTagWrap}>
          {tagsForSheet(activeSheet).map(t => (
            <span key={t.id} style={{ ...styles.tagChip, background: `${t.color}22`, color: t.color, borderColor: `${t.color}55` }}>
              {t.label}
            </span>
          ))}
          <button
            type="button"
            style={styles.tagAddBtn}
            title="Edit tags"
            onClick={() => setTagEditorId(prev => (prev === activeSheet.id ? null : activeSheet.id))}
          >
            {tagsForSheet(activeSheet).length ? '+' : 'Add tag'}
          </button>
          {tagEditorId === activeSheet.id && (
            <TagEditor
              tags={tags}
              selected={activeSheet.tag_ids || []}
              onToggle={(tagId) => toggleSheetTag(activeSheet, tagId)}
              onCreate={(label) => createTagFor(activeSheet, label)}
              onClose={() => setTagEditorId(null)}
            />
          )}
        </div>

        {/* Film-queue status + estimated minutes. Assignments deliberately
            don't live here — they're edited in the Film Queue view. */}
        <select
          value={activeSheet.status || 'drafting'}
          onChange={e => setSheetStatus(activeSheet, e.target.value)}
          title="Beat sheet status"
          style={{
            ...styles.statusSelect,
            color: (STATUS_BY_VALUE[activeSheet.status] || STATUS_BY_VALUE.drafting).color,
          }}
        >
          {BEAT_SHEET_STATUSES.map(s => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        <label style={styles.minutesWrap} title="Estimated film minutes">
          <input
            type="number"
            min={1}
            max={120}
            value={activeSheet.estimated_minutes ?? ''}
            placeholder="min"
            onChange={e => {
              const v = e.target.value;
              writeSheetFields(activeSheet, { estimated_minutes: v === '' ? null : Math.max(1, Math.round(Number(v) || 0)) });
            }}
            style={styles.minutesInput}
          />
        </label>
        {activeSheet.film_date && (
          <span style={styles.filmDateChip} title="Set by the session packer">
            Films {new Date(activeSheet.film_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        )}

        {/* Actions — every toolbar tool lives in this one dropdown now */}
        <div style={{ position: 'relative', marginLeft: 'auto' }}>
          <button
            ref={templateBtnRef}
            onClick={() => setActionsMenu(prev => (prev ? null : 'menu'))}
            style={styles.btnPrimary}
          >
            {pushingSheet || pushingScript ? 'Pushing…' : 'Actions ▾'}
          </button>
          {actionsMenu === 'menu' && (
            <div style={styles.templatesDropdown}>
              <button style={styles.actionsItem} onClick={() => { setActionsMenu(null); saveAsTemplate(); }}>
                Save as Template
              </button>
              <button style={styles.actionsItem} onClick={() => { fetchTemplates(); setActionsMenu('templates'); }}>
                Load a Template
              </button>
              <button style={styles.actionsItem} onClick={() => { setActionsMenu(null); setFindAssetsOpen(true); }}>
                Find Assets
              </button>
              <button style={styles.actionsItem} disabled={pushingScript} onClick={() => { setActionsMenu(null); pushScript(); }}>
                Push Script to Teleprompter
              </button>
              <button style={styles.actionsItem} disabled={pushingSheet} onClick={handlePushBeatSheetAction}>
                Push Beat Sheet
              </button>
              <button style={styles.actionsItem} onClick={() => { setActionsMenu(null); openVersionHistory(); }}>
                History
              </button>
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', margin: '4px 0' }} />
              <button style={{ ...styles.actionsItem, color: 'rgba(255,255,255,0.45)', fontSize: 12 }} onClick={() => { setActionsMenu(null); openFolderBrowser(); }}>
                Drive folder: {driveFolderName || 'not set'} — change…
              </button>
            </div>
          )}
          {actionsMenu === 'templates' && (
            <div style={styles.templatesDropdown}>
              <button onClick={() => setActionsMenu('menu')} style={styles.actionsItem}>← Back</button>
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', margin: '4px 0' }} />
              {templatesLoading ? (
                <div style={{ padding: '12px 16px', fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Loading...</div>
              ) : templates.length === 0 ? (
                <div style={{ padding: '12px 16px', fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>No templates yet</div>
              ) : (
                templates.map(t => (
                  <div key={t.id} style={styles.templateRow}>
                    <button onClick={() => { setActionsMenu(null); loadTemplate(t); }} style={styles.templateName}>
                      <span>{t.name}</span>
                      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>{countBeats(t.beats || [])} beats</span>
                    </button>
                    <button onClick={() => renameTemplate(t.id, t.name)} style={styles.templateDelete} title="Rename template">&#9998;</button>
                    <button onClick={() => deleteTemplate(t.id, t.name)} style={styles.templateDelete} title="Delete template">&times;</button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
      )}

      {viewMode === VIEW_BEATS ? beatSheetBody : (
        <div ref={splitWrapRef} style={styles.splitWrap}>
          <div style={beatPaneStyle}>
            <div style={styles.beatPane}>{beatSheetBody}</div>
          </div>

          {viewMode === VIEW_SPLIT && (
            <div
              style={styles.splitDivider}
              onMouseDown={startSplitDrag}
              onDoubleClick={() => {
                setSplitRatio(0.5);
                try { localStorage.setItem(SPLIT_RATIO_KEY, '0.5'); } catch { /* ignore */ }
              }}
              title="Drag to resize — double-click to even out"
              className="no-print"
            >
              <div style={styles.splitDividerGrip} />
            </div>
          )}

          <div style={researchPaneStyle}>
            <div style={styles.researchPane}>{researchPane}</div>
          </div>
        </div>
      )}

      {renderFolderBrowser()}
      {renderVersionHistory()}
      {findAssetsOpen && activeSheet && (
        <FindAssetsModal
          sheetId={activeSheet.id}
          beats={beats}
          initialReview={activeSheet.asset_review || {}}
          onClose={(finalReview) => {
            setFindAssetsOpen(false);
            // Keep the in-memory sheet in sync so reopening without a refetch
            // shows the saved review state.
            setActiveSheet((prev) => (prev ? { ...prev, asset_review: finalReview } : prev));
          }}
        />
      )}
      {renderToast()}

      {/* Context menu */}
      {contextMenu && (
        <div
          style={styles.contextMenuBackdrop}
          onClick={() => setContextMenu(null)}
          onContextMenu={e => { e.preventDefault(); setContextMenu(null); }}
        >
          <div style={{ ...styles.contextMenuPopup, top: contextMenu.y, left: contextMenu.x }}>
            {contextMenu.isSegmentHeader ? (
              <>
                <button
                  style={styles.contextMenuItem}
                  onClick={() => { dissolveSegment(contextMenu.segmentId); setContextMenu(null); }}
                >
                  Dissolve Segment
                </button>
                <button
                  style={{ ...styles.contextMenuItem, color: '#ef4444' }}
                  onClick={() => { deleteSegment(contextMenu.segmentId); setContextMenu(null); }}
                >
                  Delete Segment
                </button>
              </>
            ) : (
              <>
                {/* Tag right-click: Mark done (asset sourced elsewhere) + Edit */}
                {contextMenu.tag && (
                  <>
                    <button
                      style={{ ...styles.contextMenuItem, color: '#22c55e' }}
                      onClick={() => { toggleTagDone(contextMenu.tag.key, !contextMenu.tag.done); setContextMenu(null); }}
                    >
                      {contextMenu.tag.done ? '↺ Mark not done' : '✓ Mark done — asset sourced'}
                    </button>
                    <button
                      style={styles.contextMenuItem}
                      onClick={() => {
                        setEditingTag({
                          beatId: contextMenu.beatId,
                          field: contextMenu.tag.field,
                          index: contextMenu.tag.index,
                          value: contextMenu.tag.value,
                        });
                        setContextMenu(null);
                      }}
                    >
                      ✎ Edit tag
                    </button>
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', margin: '4px 0' }} />
                  </>
                )}
                <button
                  style={styles.contextMenuItem}
                  onClick={() => { duplicateBeat(contextMenu.beatId); setContextMenu(null); }}
                >
                  Duplicate
                </button>
                <button
                  style={{ ...styles.contextMenuItem, color: '#ef4444' }}
                  onClick={() => { deleteBeat(contextMenu.beatId); setContextMenu(null); }}
                >
                  Delete
                </button>
                {/* Move to Segment — only show for top-level beats when segments exist */}
                {!contextMenu.segmentId && beats.some(isSegment) && (
                  <>
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', margin: '4px 0' }} />
                    {beats.filter(isSegment).map(seg => (
                      <button
                        key={seg.id}
                        style={styles.contextMenuItem}
                        onClick={() => { moveBeatToSegment(contextMenu.beatId, seg.id); setContextMenu(null); }}
                      >
                        Move to {seg.title || 'Untitled Segment'}
                      </button>
                    ))}
                  </>
                )}
                {/* Move to Top Level — only show for beats inside a segment */}
                {contextMenu.segmentId && (
                  <>
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', margin: '4px 0' }} />
                    <button
                      style={styles.contextMenuItem}
                      onClick={() => { moveBeatToTopLevel(contextMenu.beatId); setContextMenu(null); }}
                    >
                      Move to Top Level
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── styles ────────────────────────────────────────────────────────────────────

const styles = {
  page: {
    padding: '36px 40px 64px',
    maxWidth: '1500px',
    margin: '0 auto',
    fontFamily: "'DM Sans', sans-serif",
    minHeight: '100%',
  },

  // ── landing ──
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  pageTitle: {
    fontSize: 22,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.9)',
    margin: 0,
  },
  sheetList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  folderSection: {
    marginBottom: 4,
  },
  folderDragHandle: {
    cursor: 'grab',
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0,
    padding: '0 2px',
  },
  folderSectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: 'none',
    border: 'none',
    padding: '7px 6px',
    cursor: 'pointer',
    width: '100%',
    borderRadius: 8,
    fontFamily: "'DM Sans', sans-serif",
  },
  folderSectionTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.65)',
    flex: 1,
    textAlign: 'left',
  },
  folderCount: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.3)',
    background: 'rgba(255,255,255,0.06)',
    borderRadius: 10,
    padding: '1px 8px',
    fontFamily: "'DM Sans', sans-serif",
  },
  folderDropZone: {
    marginLeft: 22,
    paddingLeft: 14,
    paddingTop: 4,
    paddingBottom: 4,
    borderLeft: '2px solid rgba(255,255,255,0.05)',
    borderRadius: 2,
    marginBottom: 8,
    transition: 'background 0.12s, border-color 0.12s',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  folderEmptyHint: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.18)',
    padding: '14px 0',
    textAlign: 'center',
  },
  sheetDragHandle: {
    cursor: 'grab',
    padding: '0 10px 0 0',
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0,
  },
  sheetCard: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '12px 14px',
    background: 'rgba(255,255,255,0.04)',
    borderRadius: 10,
    border: '1px solid rgba(255,255,255,0.06)',
    position: 'relative',
  },
  sheetTitle: {
    fontSize: 15,
    fontWeight: 500,
    color: 'rgba(255,255,255,0.9)',
  },
  sheetMeta: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.35)',
    marginTop: 2,
  },
  actionBtn: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.35)',
    cursor: 'pointer',
    padding: 6,
    borderRadius: 6,
    display: 'flex',
    alignItems: 'center',
  },
  confirmRow: {
    position: 'absolute',
    right: 18,
    top: '50%',
    transform: 'translateY(-50%)',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: 'rgba(15,15,26,0.95)',
    padding: '6px 10px',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.1)',
  },
  emptyState: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 60,
  },

  // ── landing: type sections (table-style, modeled on Ideas.js) ──
  sectionsWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  section: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 12,
    padding: '10px 12px 12px',
  },
  sectionHeaderBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    background: 'none',
    border: 'none',
    padding: '6px 4px',
    cursor: 'pointer',
    width: '100%',
    fontFamily: "'DM Sans', sans-serif",
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'left',
  },
  sectionCount: {
    fontSize: 11,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.4)',
    background: 'rgba(255,255,255,0.06)',
    padding: '2px 8px',
    borderRadius: 10,
  },
  sectionRows: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    marginTop: 8,
  },
  sectionEmpty: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.25)',
    padding: '8px 6px',
  },
  sheetRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '10px 12px',
    background: 'rgba(255,255,255,0.04)',
    borderRadius: 10,
    border: '1px solid rgba(255,255,255,0.06)',
  },
  rowMain: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 2,
    flex: 1,
    cursor: 'pointer',
    textAlign: 'left',
  },
  rowRenameInput: {
    flex: 1,
    background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(91, 143, 199,0.5)',
    borderRadius: 6,
    padding: '6px 10px',
    color: '#fff',
    fontSize: 15,
    fontWeight: 500,
    fontFamily: "'DM Sans', sans-serif",
    outline: 'none',
  },
  ctxOverlay: { position: 'fixed', inset: 0, zIndex: 999 },
  ctxMenu: {
    position: 'fixed',
    zIndex: 1000,
    background: colors.bgHover,
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 10,
    padding: 4,
    minWidth: 190,
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
  },
  ctxItem: {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    background: 'none',
    border: 'none',
    borderRadius: 6,
    padding: '8px 12px',
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
  },
  ctxLabel: {
    padding: '6px 12px 3px',
    fontSize: 10,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    color: 'rgba(255,255,255,0.35)',
  },
  ctxTypeItem: {
    padding: '6px 12px 6px 20px',
    fontSize: 12.5,
  },
  ctxDivider: {
    borderTop: '1px solid rgba(255,255,255,0.08)',
    margin: '4px 0',
  },
  // ── landing table ──
  theadRow: {
    display: 'grid',
    gridTemplateColumns: TABLE_COLS,
    alignItems: 'center',
    gap: spacing.md,
    padding: `${spacing.xs}px ${spacing.md}px`,
    borderBottom: `1px solid ${colors.border}`,
  },
  tableRow: {
    display: 'grid',
    gridTemplateColumns: TABLE_COLS,
    alignItems: 'center',
    gap: spacing.md,
    padding: `${spacing.sm}px ${spacing.md}px`,
    borderBottom: `1px solid ${colors.whiteA03}`,
    background: colors.bg,
  },
  statusPill: {
    display: 'inline-block',
    padding: '3px 10px',
    borderRadius: 999,
    border: '1px solid',
    fontSize: 11,
    fontWeight: 600,
    whiteSpace: 'nowrap',
    justifySelf: 'start',
  },
  tableRowDragging: {
    background: colors.bgHover,
    borderRadius: radii.sm,
    boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
  },
  dragHandle: {
    cursor: 'grab',
    color: colors.textDim,
    fontSize: fontSizes.xs,
    lineHeight: 1,
    userSelect: 'none',
    letterSpacing: '-2px',
  },
  cellTitle: {
    fontSize: fontSizes.md,
    color: colors.text,
    textAlign: 'left',
    cursor: 'pointer',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    padding: 0,
  },
  cellNum: {
    fontSize: fontSizes.sm,
    color: colors.textMuted,
    fontVariantNumeric: 'tabular-nums',
  },
  cellDate: {
    fontSize: fontSizes.xs,
    color: colors.textSubtle,
    whiteSpace: 'nowrap',
  },
  cellWho: {
    fontSize: fontSizes.xs,
    color: colors.textSubtle,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  tagCell: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: spacing.xs,
    flexWrap: 'wrap',
    minWidth: 0,
  },
  tagChip: {
    display: 'inline-block',
    padding: `1px ${spacing.sm}px`,
    border: '1px solid',
    borderRadius: radii.pill,
    fontSize: fontSizes.xxs,
    fontWeight: fontWeights.semibold,
    whiteSpace: 'nowrap',
  },
  tagAddBtn: {
    padding: `1px ${spacing.sm}px`,
    background: 'transparent',
    border: `1px dashed ${colors.borderStrong}`,
    borderRadius: radii.pill,
    color: colors.textDim,
    fontSize: fontSizes.xxs,
    fontFamily: 'inherit',
    cursor: 'pointer',
    flexShrink: 0,
  },
  configTagWrap: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: spacing.xs,
    flexWrap: 'wrap',
    maxWidth: 300,
  },
  sectionRowsOver: {
    background: colors.accentA06,
    borderRadius: radii.sm,
    outline: `1px dashed ${colors.accentBorder}`,
  },
  clearSortBtn: {
    padding: `${spacing.xs}px ${spacing.md}px`,
    background: colors.bgInput,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.sm,
    color: colors.textMuted,
    fontSize: fontSizes.sm,
    fontFamily: 'inherit',
    cursor: 'pointer',
  },
  sortNote: {
    margin: `0 0 ${spacing.md}px`,
    fontSize: fontSizes.xs,
    color: colors.textDim,
  },

  // ── editor ──
  viewSwitchRow: {
    position: 'relative',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
    flexShrink: 0,
  },
  viewSwitchRowBack: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.5)',
    cursor: 'pointer',
    padding: 4,
    display: 'flex',
    position: 'absolute',
    left: 0,
    top: '50%',
    transform: 'translateY(-50%)',
  },
  configBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 20,
    paddingBottom: 14,
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    flexWrap: 'wrap',
  },

  // ── view modes: Beat Sheet / Research / Split ──
  // Beats-only keeps the page's own scroll. The other two pin the page to the
  // viewport instead, because a document pane that grows the page would push
  // its own toolbar off-screen.
  pageFullHeight: {
    height: '100%',
    minHeight: 0,
    maxWidth: 'none',
    padding: '20px 24px 20px',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  viewSwitch: {
    display: 'flex',
    gap: spacing.xs,
    padding: spacing.xs,
    background: colors.whiteA05,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.lg,
    flexShrink: 0,
  },
  viewSwitchBtn: {
    ...buttonReset,
    padding: '6px 12px',
    borderRadius: radii.sm,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
    color: colors.textSubtle,
    fontFamily,
    cursor: 'pointer',
    transition: transitions.fast,
  },
  viewSwitchBtnActive: {
    background: colors.accentA22,
    color: colors.text,
  },
  splitWrap: {
    flex: 1,
    display: 'flex',
    minHeight: 0,
  },
  splitPane: {
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  beatPane: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    overflowX: 'hidden',
    paddingRight: 8,
  },
  researchPane: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    border: `1px solid ${colors.border}`,
    borderRadius: radii.lg,
    overflow: 'hidden',
    background: colors.bg,
  },
  splitDivider: {
    order: 1,
    width: 12,
    flexShrink: 0,
    cursor: 'col-resize',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  splitDividerGrip: {
    width: 3,
    height: 48,
    borderRadius: radii.xs,
    background: colors.borderStrong,
  },
  researchFallback: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    fontSize: fontSizes.md,
    color: colors.whiteA45,
    fontFamily,
  },
  titleInput: {
    flex: 1,
    minWidth: 180,
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 8,
    padding: '8px 14px',
    color: 'rgba(255,255,255,0.9)',
    fontSize: 15,
    fontWeight: 600,
    fontFamily: "'DM Sans', sans-serif",
    outline: 'none',
  },
  folderBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 8,
    padding: '8px 14px',
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
  },
  saveIndicator: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.3)',
    marginLeft: 'auto',
    whiteSpace: 'nowrap',
  },
  updatedIndicator: {
    fontSize: 12,
    color: colors.textPlaceholder,
    marginLeft: spacing.md,
    whiteSpace: 'nowrap',
  },

  // ── column headers ──
  columnHeaders: {
    display: 'flex',
    gap: 0,
    marginBottom: 8,
    paddingLeft: 36,
  },
  colHeaderLeft: {
    flex: 2,
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: 'rgba(255,255,255,0.3)',
    padding: '0 8px',
  },
  colHeader: {
    flex: 1,
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: 'rgba(255,255,255,0.3)',
    padding: '0 8px',
  },

  // ── beat row ──
  beatRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 0,
    padding: '12px 0',
    background: 'rgba(255,255,255,0.02)',
    borderRadius: 10,
    border: '1px solid rgba(255,255,255,0.05)',
    marginBottom: 6,
  },
  dragHandle: {
    width: 28,
    minWidth: 28,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 10,
    cursor: 'grab',
    flexShrink: 0,
  },
  beatCol: {
    flex: 2,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    padding: '0 8px',
  },
  beatInput: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 6,
    padding: '8px 12px',
    color: 'rgba(255,255,255,0.9)',
    fontSize: 14,
    fontWeight: 600,
    fontFamily: "'DM Sans', sans-serif",
    outline: 'none',
    resize: 'none',
    overflow: 'hidden',
    lineHeight: 1.5,
  },
  contextInput: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 6,
    padding: '8px 12px',
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    fontFamily: "'DM Sans', sans-serif",
    outline: 'none',
    resize: 'none',
    overflow: 'hidden',
    lineHeight: 1.5,
  },
  addContextBtn: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.3)',
    fontSize: 12,
    fontFamily: "'DM Sans', sans-serif",
    cursor: 'pointer',
    padding: '2px 0',
    alignSelf: 'flex-start',
  },

  // ── notes column ──
  notesCol: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    padding: '0 8px',
  },
  notesInput: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 6,
    padding: '8px 12px',
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    fontFamily: "'DM Sans', sans-serif",
    outline: 'none',
    resize: 'none',
    overflow: 'hidden',
    lineHeight: 1.5,
    width: '100%',
    boxSizing: 'border-box',
  },

  // ── tag columns ──
  tagCol: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    padding: '0 8px',
  },
  tag: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    background: colors.accentA12,
    border: '1px solid rgba(91, 143, 199,0.2)',
    borderRadius: 6,
    padding: '4px 8px',
    width: 'fit-content',
    maxWidth: '100%',
  },
  // Tag marked "done" (asset sourced elsewhere) — Find Assets skips it.
  tagDone: {
    background: 'rgba(34,197,94,0.14)',
    border: '1px solid rgba(34,197,94,0.4)',
  },
  tagText: {
    fontSize: 12,
    color: colors.accentFg,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  tagRemove: {
    background: 'none',
    border: 'none',
    color: 'rgba(165,180,252,0.6)',
    cursor: 'pointer',
    fontSize: 14,
    padding: '0 2px',
    lineHeight: 1,
    flexShrink: 0,
  },
  tagInput: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 6,
    padding: '6px 10px',
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    fontFamily: "'DM Sans', sans-serif",
    outline: 'none',
  },
  // In-place editor swapped in for a tag chip (context menu → Edit tag)
  tagEditInput: {
    background: colors.accentA12,
    border: '1px solid rgba(91, 143, 199,0.5)',
    borderRadius: 6,
    padding: '4px 8px',
    color: '#fff',
    fontSize: 12,
    fontFamily: "'DM Sans', sans-serif",
    outline: 'none',
    width: '100%',
    maxWidth: '100%',
  },
  tagColDrop: {
    background: colors.accentA08,
    borderRadius: 8,
    outline: '2px dashed rgba(91, 143, 199,0.4)',
    outlineOffset: 2,
  },
  mediaThumb: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    background: colors.accentA08,
    border: '1px solid rgba(91, 143, 199,0.15)',
    borderRadius: 6,
    padding: '4px 6px',
    width: '100%',
    maxWidth: '100%',
    boxSizing: 'border-box',
  },
  mediaImg: {
    width: 36,
    height: 36,
    objectFit: 'cover',
    borderRadius: 4,
    flexShrink: 0,
  },
  mediaVideoIcon: {
    width: 36,
    height: 36,
    background: 'rgba(255,255,255,0.06)',
    borderRadius: 4,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  mediaName: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.45)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flex: 1,
    minWidth: 0,
  },
  uploadingIndicator: {
    fontSize: 11,
    color: 'rgba(165,180,252,0.6)',
    padding: '4px 2px',
    fontFamily: "'DM Sans', sans-serif",
  },
  deleteBeatBtn: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.2)',
    cursor: 'pointer',
    padding: '10px 8px',
    display: 'flex',
    flexShrink: 0,
  },

  // ── add beat ──
  addBeatBtn: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px dashed rgba(255,255,255,0.1)',
    borderRadius: 10,
    padding: '12px 0',
    width: '100%',
    color: 'rgba(255,255,255,0.3)',
    fontSize: 14,
    cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
    marginTop: 4,
  },

  // ── buttons ──
  btnPrimary: {
    background: colors.accent,
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '8px 18px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
    whiteSpace: 'nowrap',
  },
  btnSecondary: {
    background: 'rgba(255,255,255,0.08)',
    color: 'rgba(255,255,255,0.7)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8,
    padding: '8px 18px',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
    whiteSpace: 'nowrap',
  },
  btnSmall: {
    background: 'rgba(255,255,255,0.08)',
    color: 'rgba(255,255,255,0.7)',
    border: 'none',
    borderRadius: 6,
    padding: '4px 12px',
    fontSize: 12,
    cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
  },
  iconBtn: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.5)',
    fontSize: 20,
    cursor: 'pointer',
    padding: '0 4px',
  },

  // ── modal ──
  modalOverlay: {
    position: 'fixed',
    top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  modal: {
    background: colors.bgHover,
    borderRadius: 14,
    padding: 24,
    width: 480,
    maxWidth: '90vw',
    border: '1px solid rgba(255,255,255,0.1)',
    boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
  },
  breadcrumb: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    cursor: 'pointer',
    padding: '2px 4px',
    fontFamily: "'DM Sans', sans-serif",
  },
  folderRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 12px',
    borderRadius: 6,
    cursor: 'pointer',
    color: 'rgba(255,255,255,0.8)',
    fontSize: 14,
  },
  input: {
    flex: 1,
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 6,
    padding: '6px 12px',
    color: 'rgba(255,255,255,0.9)',
    fontSize: 13,
    fontFamily: "'DM Sans', sans-serif",
    outline: 'none',
  },

  // ── add menu ──
  addMenuDropdown: {
    position: 'absolute',
    left: '50%',
    transform: 'translateX(-50%)',
    top: '100%',
    marginTop: 6,
    background: colors.bgHover,
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 8,
    padding: '4px 0',
    minWidth: 120,
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
    zIndex: 100,
  },
  addMenuItem: {
    display: 'block',
    width: '100%',
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.8)',
    fontSize: 13,
    fontFamily: "'DM Sans', sans-serif",
    padding: '8px 16px',
    textAlign: 'left',
    cursor: 'pointer',
  },

  // ── segments ──
  segmentContainer: {
    borderRadius: 10,
    marginBottom: 6,
    padding: '8px 0 4px',
  },
  segmentHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '0 8px 8px',
  },
  segmentTitleInput: {
    flex: 1,
    background: 'none',
    border: 'none',
    fontSize: 14,
    fontWeight: 700,
    fontFamily: "'DM Sans', sans-serif",
    outline: 'none',
    padding: '4px 8px',
    color: colors.accent,
  },
  colorDropdown: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: 6,
    background: colors.bgHover,
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 8,
    padding: 8,
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    width: 130,
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
    zIndex: 100,
  },
  colorDot: {
    width: 14,
    height: 14,
    borderRadius: '50%',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    flexShrink: 0,
  },
  addBeatInSegmentBtn: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.25)',
    fontSize: 12,
    cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
    padding: '6px 36px',
    textAlign: 'left',
  },

  // ── templates ──
  actionsItem: {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    background: 'none',
    border: 'none',
    padding: '8px 16px',
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: "'DM Sans', sans-serif",
  },
  templatesDropdown: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: 6,
    background: colors.bgHover,
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 10,
    padding: '6px 0',
    minWidth: 240,
    maxHeight: 340,
    overflowY: 'auto',
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
    zIndex: 100,
  },
  templatesSaveBtn: {
    display: 'block',
    width: '100%',
    background: 'none',
    border: 'none',
    color: colors.accentFg,
    fontSize: 13,
    fontWeight: 600,
    fontFamily: "'DM Sans', sans-serif",
    padding: '10px 16px',
    textAlign: 'left',
    cursor: 'pointer',
  },
  templateRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  templateName: {
    flex: 1,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.8)',
    fontSize: 13,
    fontFamily: "'DM Sans', sans-serif",
    padding: '8px 16px',
    textAlign: 'left',
    cursor: 'pointer',
    minWidth: 0,
  },
  templateDelete: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.3)',
    fontSize: 16,
    cursor: 'pointer',
    padding: '4px 8px',
    flexShrink: 0,
  },

  // ── create modal ──
  createLabel: {
    display: 'block',
    fontSize: 12,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.5)',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  createOptionList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    maxHeight: 240,
    overflowY: 'auto',
  },
  createOption: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid transparent',
    borderRadius: 8,
    color: 'rgba(255,255,255,0.8)',
    fontSize: 13,
    fontFamily: "'DM Sans', sans-serif",
    padding: '10px 12px',
    textAlign: 'left',
    cursor: 'pointer',
  },
  createOptionActive: {
    background: colors.accentA15,
    border: '1px solid rgba(91, 143, 199,0.4)',
  },
  createRadio: (active) => ({
    width: 14,
    height: 14,
    borderRadius: '50%',
    flexShrink: 0,
    border: active ? '4px solid #5b8fc7' : '2px solid rgba(255,255,255,0.25)',
    boxSizing: 'border-box',
  }),

  // ── context menu ──
  contextMenuBackdrop: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9999,
  },
  contextMenuPopup: {
    position: 'fixed',
    background: colors.bgHover,
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 8,
    padding: '4px 0',
    minWidth: 140,
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
    zIndex: 10000,
  },
  contextMenuItem: {
    display: 'block',
    width: '100%',
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.8)',
    fontSize: 13,
    fontFamily: "'DM Sans', sans-serif",
    padding: '8px 16px',
    textAlign: 'left',
    cursor: 'pointer',
  },

  // ── film-queue fields in the config bar ──
  statusSelect: {
    padding: '6px 8px',
    background: colors.whiteA06,
    border: `1px solid ${colors.borderStrong}`,
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 600,
    fontFamily: "'DM Sans', sans-serif",
    outline: 'none',
    cursor: 'pointer',
    flexShrink: 0,
  },
  minutesWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 11,
    color: colors.whiteA45,
    flexShrink: 0,
  },
  minutesInput: {
    width: 48,
    padding: '6px 6px',
    background: colors.whiteA06,
    border: `1px solid ${colors.borderStrong}`,
    borderRadius: 8,
    color: colors.textBright,
    fontSize: 12,
    fontFamily: "'DM Sans', sans-serif",
    outline: 'none',
    boxSizing: 'border-box',
  },
  filmDateChip: {
    padding: '3px 9px',
    borderRadius: 10,
    border: `1px solid ${colors.borderStrong}`,
    fontSize: 11,
    fontWeight: 600,
    color: colors.textMuted,
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },

};
