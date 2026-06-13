import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { callWorkflowFn } from '../lib/workflowApi';

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;

// ─── helpers ───────────────────────────────────────────────────────────────────

function newBeat() {
  return { id: crypto.randomUUID(), title: '', context: '', graphics: [], videos: [], notes: '' };
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
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const ARCHIVE_FOLDER = { id: 'archive', label: 'Archive' };

// ─── B-Roll source styling ────────────────────────────────────────────────────
const SOURCE_COLORS = {
  mlb: { bg: 'rgba(0,45,114,0.25)', fg: '#6d9eeb' },
  youtube: { bg: 'rgba(255,0,0,0.12)', fg: '#ff6b6b' },
  espn: { bg: 'rgba(204,0,0,0.15)', fg: '#ff8a8a' },
  yahoo: { bg: 'rgba(75,0,130,0.15)', fg: '#b794f4' },
  athletic: { bg: 'rgba(200,150,50,0.15)', fg: '#f0c674' },
  other: { bg: 'rgba(255,255,255,0.06)', fg: 'rgba(255,255,255,0.5)' },
};
const SOURCE_LABELS = { mlb: 'MLB', youtube: 'YouTube', espn: 'ESPN', yahoo: 'Yahoo Sports', athletic: 'The Athletic', other: 'Web' };

// ─── component ─────────────────────────────────────────────────────────────────

export default function Production({ initialSheetId, onSheetOpened }) {
  const { profile } = useAuth();
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
  const saveTimer = useRef(null);
  const tagDragRef = useRef(null);

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

  // ── b-roll search state ──
  const [brollLoading, setBrollLoading] = useState({});

  // ── context menu ──
  const [contextMenu, setContextMenu] = useState(null); // { x, y, beatId, segmentId, isSegmentHeader }

  // ── templates ──
  const [showTemplates, setShowTemplates] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const templateBtnRef = useRef(null);

  // ── new-sheet create modal ──
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createTemplateId, setCreateTemplateId] = useState(null); // null = blank
  const [createBusy, setCreateBusy] = useState(false);

  // ── add menu ──
  const [showAddMenuTop, setShowAddMenuTop] = useState(false);
  const [showAddMenuBottom, setShowAddMenuBottom] = useState(false);
  const [showColorDropdown, setShowColorDropdown] = useState(null); // segmentId or null

  // ── confirm delete ──
  const [confirmDelete, setConfirmDelete] = useState(null);

  // ── dynamic folders ──
  const [dbFolders, setDbFolders] = useState([]);
  const [renamingFolderId, setRenamingFolderId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderInputValue, setNewFolderInputValue] = useState('');

  // ── folder sections ──
  const [collapsedFolders, setCollapsedFolders] = useState(new Set(['ideas', 'archive', 'unfiled']));
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
  const fetchSheets = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('beat_sheets')
      .select('*')
      .eq('is_archived', false)
      .order('updated_at', { ascending: false });
    if (error) console.error('Fetch beat sheets error:', error);
    setSheets(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchSheets(); }, [fetchSheets]);

  // ─── fetch folders ────────────────────────────────────────────────────────────
  const fetchFolders = useCallback(async () => {
    const { data, error } = await supabase
      .from('beat_sheet_folders')
      .select('*')
      .order('position', { ascending: true });
    if (error) console.error('Fetch folders error:', error);
    setDbFolders(data || []);
  }, []);

  useEffect(() => { fetchFolders(); }, [fetchFolders]);

  // ─── realtime subscription for folders ────────────────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel('beat_sheet_folders_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'beat_sheet_folders' }, () => {
        fetchFolders();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchFolders]);

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
      const { error } = await supabase
        .from('beat_sheets')
        .update({
          title,
          beats,
          drive_folder_id: driveFolderId,
          drive_folder_name: driveFolderName,
          updated_at: new Date().toISOString(),
        })
        .eq('id', activeSheet.id);
      if (error) {
        console.error('Auto-save error:', error);
        setSaveStatus('unsaved');
      } else {
        setSaveStatus('saved');
      }
    }, 1500);
  }, [activeSheet, title, beats, driveFolderId, driveFolderName]);

  useEffect(() => {
    if (activeSheet) scheduleSave();
    return () => clearTimeout(saveTimer.current);
  }, [title, beats, driveFolderId, driveFolderName]);

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
    setShowCreateModal(true);
    fetchTemplates();
  };

  const confirmCreate = async () => {
    const name = createName.trim();
    if (!name || createBusy) return;
    setCreateBusy(true);
    let initialBeats = [newBeat()];
    if (createTemplateId) {
      const tpl = templates.find(t => t.id === createTemplateId);
      const cloned = cloneBeatsFresh(tpl?.beats || []);
      if (cloned.length) initialBeats = cloned;
    }
    const { data, error } = await supabase
      .from('beat_sheets')
      .insert({ user_id: profile.id, title: name, beats: initialBeats })
      .select()
      .single();
    setCreateBusy(false);
    if (error) { console.error(error); return; }
    setShowCreateModal(false);
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
        folder: sheet.folder,
      })
      .select()
      .single();
    if (error) { console.error('Duplicate error:', error); return; }
    setSheets(prev => [data, ...prev]);
  };

  const handleCreateFolder = async () => {
    const name = newFolderInputValue.trim();
    if (!name) return;
    const maxPos = dbFolders.length > 0 ? Math.max(...dbFolders.map(f => f.position)) + 1 : 0;
    const id = crypto.randomUUID();
    setDbFolders(prev => [...prev, { id, name, position: maxPos, created_by: profile?.id }]);
    setShowNewFolderInput(false);
    setNewFolderInputValue('');
    const { error } = await supabase.from('beat_sheet_folders').insert({ id, name, position: maxPos, created_by: profile?.id });
    if (error) { console.error('Create folder error:', error); fetchFolders(); }
  };

  const handleRenameFolder = async (folderId) => {
    const name = renameValue.trim();
    if (!name) { setRenamingFolderId(null); return; }
    setDbFolders(prev => prev.map(f => f.id === folderId ? { ...f, name } : f));
    setRenamingFolderId(null);
    const { error } = await supabase.from('beat_sheet_folders').update({ name }).eq('id', folderId);
    if (error) { console.error('Rename folder error:', error); fetchFolders(); }
  };

  const handleDeleteFolder = async (folderId) => {
    if (!(await confirm('Delete this folder? Sheets inside will be moved to Unfiled.'))) return;
    setSheets(prev => prev.map(s => s.folder === folderId ? { ...s, folder: null } : s));
    setDbFolders(prev => prev.filter(f => f.id !== folderId));
    await supabase.from('beat_sheets').update({ folder: null }).eq('folder', folderId);
    await supabase.from('beat_sheet_folders').delete().eq('id', folderId);
  };

  const openSheet = (sheet) => {
    setActiveSheet(sheet);
    setTitle(sheet.title);
    const loadedBeats = sheet.beats || [newBeat()];
    setBeats(loadedBeats);
    setDriveFolderId(sheet.drive_folder_id);
    setDriveFolderName(sheet.drive_folder_name);
    setSaveStatus('saved');
    setTagInputs({});
    setExpandedContexts(new Set(flattenBeats(loadedBeats).filter(b => b.context).map(b => b.id)));
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

  const closeEditor = async () => {
    clearTimeout(saveTimer.current);
    clearInterval(snapshotTimer.current);
    // force-save before leaving if unsaved; await so fetchSheets gets fresh data
    if (saveStatus !== 'saved' && activeSheet) {
      await supabase.from('beat_sheets').update({
        title, beats,
        drive_folder_id: driveFolderId,
        drive_folder_name: driveFolderName,
        updated_at: new Date().toISOString(),
      }).eq('id', activeSheet.id);
    }
    // save version snapshot on close
    if (activeSheet) await saveSnapshot(activeSheet.id, title, beats);
    setActiveSheet(null);
    setShowVersionHistory(false);
    setVersions([]);
    setPreviewVersion(null);
    fetchSheets();
  };

  const archiveSheet = async (id) => {
    await supabase.from('beat_sheets').update({ is_archived: true }).eq('id', id);
    fetchSheets();
  };

  const deleteSheet = async (id, title) => {
    if (!(await confirm(`Delete "${title}"? This cannot be undone.`))) return;
    await supabase.from('beat_sheets').delete().eq('id', id);
    fetchSheets();
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

  // close templates dropdown on outside click
  useEffect(() => {
    if (!showTemplates) return;
    const handler = (e) => {
      if (templateBtnRef.current && !templateBtnRef.current.parentElement.contains(e.target)) {
        setShowTemplates(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showTemplates]);

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
  const handleDragEnd = (result) => {
    const { source, destination, draggableId } = result;
    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;

    const srcIsTop = source.droppableId === 'top-level';
    const dstIsTop = destination.droppableId === 'top-level';
    const srcSegId = !srcIsTop ? source.droppableId.replace('segment-', '') : null;
    const dstSegId = !dstIsTop ? destination.droppableId.replace('segment-', '') : null;

    // Prevent dropping a segment into another segment
    const draggedIsSegment = beats.some(item => isSegment(item) && item.id === draggableId);
    if (draggedIsSegment && !dstIsTop) return;

    if (srcIsTop && dstIsTop) {
      // Reorder within top level (beats and segments)
      const reordered = Array.from(beats);
      const [moved] = reordered.splice(source.index, 1);
      reordered.splice(destination.index, 0, moved);
      setBeats(reordered);
    } else if (srcIsTop && !dstIsTop) {
      // Move beat from top level into a segment
      setBeats(prev => {
        const item = prev[source.index];
        if (isSegment(item)) return prev;
        const withoutItem = [...prev];
        withoutItem.splice(source.index, 1);
        return withoutItem.map(i => {
          if (!isSegment(i) || i.id !== dstSegId) return i;
          const children = Array.from(i.children);
          children.splice(destination.index, 0, item);
          return { ...i, children };
        });
      });
    } else if (!srcIsTop && dstIsTop) {
      // Move beat from segment to top level
      setBeats(prev => {
        let movedBeat = null;
        const updated = prev.map(item => {
          if (!isSegment(item) || item.id !== srcSegId) return item;
          const children = Array.from(item.children);
          [movedBeat] = children.splice(source.index, 1);
          return { ...item, children };
        });
        if (!movedBeat) return prev;
        const result = Array.from(updated);
        result.splice(destination.index, 0, movedBeat);
        return result;
      });
    } else if (srcSegId === dstSegId) {
      // Reorder within same segment
      setBeats(prev => prev.map(item => {
        if (!isSegment(item) || item.id !== srcSegId) return item;
        const children = Array.from(item.children);
        const [moved] = children.splice(source.index, 1);
        children.splice(destination.index, 0, moved);
        return { ...item, children };
      }));
    } else {
      // Move beat between different segments
      setBeats(prev => {
        let movedBeat = null;
        const updated = prev.map(item => {
          if (!isSegment(item)) return item;
          if (item.id === srcSegId) {
            const children = Array.from(item.children);
            [movedBeat] = children.splice(source.index, 1);
            return { ...item, children };
          }
          return item;
        });
        if (!movedBeat) return prev;
        return updated.map(item => {
          if (!isSegment(item) || item.id !== dstSegId) return item;
          const children = Array.from(item.children);
          children.splice(destination.index, 0, movedBeat);
          return { ...item, children };
        });
      });
    }

    // Re-trigger auto-resize on textareas after React re-renders the moved beat
    requestAnimationFrame(() => {
      document.querySelectorAll('[data-autoresize]').forEach(autoResize);
    });
  };

  const toggleFolder = (folderId) => {
    setCollapsedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  const handleLandingDragEnd = async (result) => {
    if (!result.destination) return;
    const { type } = result;

    if (type === 'FOLDER') {
      const { source, destination } = result;
      if (source.index === destination.index) return;
      const reordered = Array.from(dbFolders);
      const [moved] = reordered.splice(source.index, 1);
      reordered.splice(destination.index, 0, moved);
      const updated = reordered.map((f, i) => ({ ...f, position: i }));
      setDbFolders(updated);
      const updates = updated.map(f => supabase.from('beat_sheet_folders').update({ position: f.position }).eq('id', f.id));
      await Promise.all(updates);
      return;
    }

    // type === 'SHEET'
    const { draggableId: sheetId, source, destination } = result;
    if (source.droppableId === destination.droppableId) return;
    const newFolder = destination.droppableId === 'unfiled' ? null : destination.droppableId;
    setSheets(prev => prev.map(s => s.id === sheetId ? { ...s, folder: newFolder } : s));
    await supabase.from('beat_sheets').update({ folder: newFolder }).eq('id', sheetId);

    // Trigger workflow event when a sheet lands in a tracked folder.
    const FOLDER_EVENTS = { mayday: 'new_beat_sheet_mayday', tm_baseball: 'new_beat_sheet_tm_baseball' };
    const triggerEvent = FOLDER_EVENTS[newFolder];
    if (triggerEvent && source.droppableId !== newFolder) {
      const sheet = sheets.find(s => s.id === sheetId);
      try {
        await callWorkflowFn('workflow-trigger-event', {
          event: triggerEvent,
          payload: { beat_sheet_id: sheetId, title: sheet?.title || 'Untitled' },
        });
      } catch (e) { console.error('Beat sheet trigger failed:', e); }
    }
  };

  // ─── folder browser ─────────────────────────────────────────────────────────
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

  const openFolderBrowser = () => {
    setShowFolderBrowser(true);
    setFolderStack([]);
    setNewFolderName('');
    loadFolders(null);
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
    if (folderStack.length === 0) {
      // Selecting the root folder itself
      if (!driveRootId.current) return;
      setDriveFolderId(driveRootId.current);
      setDriveFolderName('Long Form');
    } else {
      const current = folderStack[folderStack.length - 1];
      setDriveFolderId(current.id);
      setDriveFolderName(folderStack.map(f => f.name).join(' / '));
    }
    setShowFolderBrowser(false);
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
  const pushBeatSheet = async () => {
    if (!driveFolderId) {
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
        body: JSON.stringify({ folderId: driveFolderId, title, beats: flattenBeats(beats) }),
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

  // ─── B-Roll search ─────────────────────────────────────────────────────────
  const findBroll = async (beatId) => {
    const allBeats = flattenBeats(beats);
    const beat = allBeats.find(b => b.id === beatId);
    if (!beat?.title?.trim()) {
      setToast({ type: 'error', message: 'Beat has no script text to search.' });
      return;
    }
    setBrollLoading(prev => ({ ...prev, [beatId]: true }));
    try {
      const { data, error } = await supabase.functions.invoke('find-broll', {
        body: { beat_text: beat.title }
      });
      if (error || data?.error) {
        setToast({ type: 'error', message: data?.error || error?.message || 'B-Roll search failed' });
        return;
      }
      if (!data.videos?.length && !data.articles?.length) {
        setToast({ type: 'error', message: 'No B-Roll suggestions found.' });
        return;
      }
      const newItems = [
        ...(data.videos || []).map(s => ({
          type: 'broll_video', title: s.title, source: s.source,
          url: s.url, description: s.description
        })),
        ...(data.articles || []).map(s => ({
          type: 'broll_article', title: s.title, source: s.source,
          url: s.url, description: s.description
        })),
      ];
      setBeats(prev => mapBeatsDeep(prev, b =>
        b.id === beatId ? { ...b, videos: [...b.videos, ...newItems] } : b
      ));
      const parts = [];
      if (data.videos?.length) parts.push(`${data.videos.length} video${data.videos.length > 1 ? 's' : ''}`);
      if (data.articles?.length) parts.push(`${data.articles.length} article${data.articles.length > 1 ? 's' : ''}`);
      setToast({ type: 'success', message: `Found ${parts.join(' and ')}.` });
    } catch (err) {
      console.error('findBroll error:', err);
      setToast({ type: 'error', message: 'B-Roll search failed.' });
    } finally {
      setBrollLoading(prev => { const n = { ...prev }; delete n[beatId]; return n; });
    }
  };

  const findBrollAll = async () => {
    const allBeats = flattenBeats(beats).filter(b => b.title?.trim());
    if (!allBeats.length) {
      setToast({ type: 'error', message: 'No beats with script text.' });
      return;
    }
    setBrollLoading(prev => {
      const n = { ...prev };
      allBeats.forEach(b => { n[b.id] = true; });
      return n;
    });
    let found = 0;
    for (const beat of allBeats) {
      try {
        const { data, error } = await supabase.functions.invoke('find-broll', {
          body: { beat_text: beat.title }
        });
        if (!error && (data?.videos?.length || data?.articles?.length)) {
          const newItems = [
            ...(data.videos || []).map(s => ({
              type: 'broll_video', title: s.title, source: s.source,
              url: s.url, description: s.description
            })),
            ...(data.articles || []).map(s => ({
              type: 'broll_article', title: s.title, source: s.source,
              url: s.url, description: s.description
            })),
          ];
          setBeats(prev => mapBeatsDeep(prev, b =>
            b.id === beat.id ? { ...b, videos: [...b.videos, ...newItems] } : b
          ));
          found += newItems.length;
        }
      } finally {
        setBrollLoading(prev => { const n = { ...prev }; delete n[beat.id]; return n; });
      }
    }
    setToast({ type: 'success', message: found ? `Found ${found} B-Roll suggestions across ${allBeats.length} beats.` : 'No suggestions found.' });
  };

  // ─── renderBeatRow (reused for top-level + segment-internal) ────────────────
  const renderBeatRow = (beat, provided, snapshot, parentSegmentId) => {
    const row = (
    <div
      ref={provided.innerRef}
      {...provided.draggableProps}
      onContextMenu={e => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, beatId: beat.id, segmentId: parentSegmentId });
      }}
      style={{
        ...styles.beatRow,
        ...(snapshot.isDragging ? { boxShadow: '0 8px 32px rgba(99,102,241,0.25)', border: '1px solid rgba(99,102,241,0.3)' } : {}),
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
              <div key={i} style={styles.mediaThumb}>
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
          return (
            <span
              key={i}
              style={{ ...styles.tag, cursor: 'grab' }}
              draggable
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
          if (typeof v === 'object' && (v.type === 'broll_video' || v.type === 'broll_article')) {
            const sc = SOURCE_COLORS[v.source] || SOURCE_COLORS.other;
            const isVideo = v.type === 'broll_video';
            return (
              <div key={i} style={{ ...styles.brollCard, borderColor: isVideo ? 'rgba(99,102,241,0.15)' : 'rgba(251,191,36,0.15)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ ...styles.brollCategory, background: isVideo ? 'rgba(99,102,241,0.15)' : 'rgba(251,191,36,0.12)', color: isVideo ? '#a5b4fc' : '#fbbf24' }}>
                    {isVideo ? 'Video' : 'Article'}
                  </div>
                  <div style={{ ...styles.brollSource, background: sc.bg, color: sc.fg }}>{SOURCE_LABELS[v.source] || v.source}</div>
                </div>
                <a href={v.url} target="_blank" rel="noopener noreferrer" style={{ ...styles.brollTitle, color: isVideo ? '#a5b4fc' : '#fbbf24' }}>
                  {v.title}
                </a>
                {v.description && <div style={styles.brollDesc}>{v.description}</div>}
                <button onClick={() => removeTag(beat.id, 'videos', i)} style={{ ...styles.tagRemove, position: 'absolute', top: 4, right: 4 }}>&times;</button>
              </div>
            );
          }
          const isMediaItem = typeof v === 'object' && v.url;
          if (isMediaItem) {
            return (
              <div key={i} style={styles.mediaThumb}>
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
          return (
            <span
              key={i}
              style={{ ...styles.tag, cursor: 'grab' }}
              draggable
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
        <button
          onClick={() => findBroll(beat.id)}
          disabled={brollLoading[beat.id]}
          style={styles.brollBtn}
          title="Find B-Roll suggestions"
        >
          {brollLoading[beat.id] ? (
            <span style={{ fontSize: 11, color: 'rgba(165,180,252,0.6)' }}>Searching...</span>
          ) : (
            <>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="5" cy="5" r="3.5" /><path d="M8 8l3 3" />
              </svg>
              <span>Find B-Roll</span>
            </>
          )}
        </button>
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
                    background: previewVersion?.id === v.id ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.03)',
                    border: previewVersion?.id === v.id ? '1px solid rgba(99,102,241,0.3)' : '1px solid transparent',
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
                        <div key={item.id || i} style={{ background: `${item.color || '#6366f1'}12`, border: `1px solid ${item.color || '#6366f1'}30`, borderLeft: `3px solid ${item.color || '#6366f1'}`, borderRadius: 6, paddingLeft: 8, paddingTop: 6, paddingBottom: 4, marginBottom: 6 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: item.color || '#6366f1', marginBottom: 4 }}>
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
      <div style={styles.modalOverlay} onMouseDown={(e) => { if (e.target === e.currentTarget) setShowFolderBrowser(false); }}>
        <div style={styles.modal} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ margin: 0, color: 'rgba(255,255,255,0.9)', fontSize: 16 }}>Select Drive Folder</h3>
            <button onClick={() => setShowFolderBrowser(false)} style={styles.iconBtn}>&times;</button>
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
              <div onClick={navigateBack} style={styles.folderRow}>
                <span style={{ fontSize: 16 }}>&#8592;</span>
                <span>Back</span>
              </div>
            )}
            {foldersLoading ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'rgba(255,255,255,0.4)' }}>Loading...</div>
            ) : folders.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'rgba(255,255,255,0.4)' }}>No folders here</div>
            ) : folders.map(f => (
              <div key={f.id} onClick={() => navigateToFolder(f.id, f.name)} style={styles.folderRow}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="#f59e0b" stroke="none">
                  <path d="M1 3.5A1.5 1.5 0 012.5 2h3.379a1.5 1.5 0 011.06.44l.622.62a1.5 1.5 0 001.06.44H13.5A1.5 1.5 0 0115 5v7.5a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 011 12.5v-9z"/>
                </svg>
                <span>{f.name}</span>
              </div>
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
            <button onClick={() => setShowFolderBrowser(false)} style={styles.btnSecondary}>Cancel</button>
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

          <label style={styles.createLabel}>Start from</label>
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
              disabled={!createName.trim() || createBusy}
              style={{ ...styles.btnPrimary, opacity: !createName.trim() || createBusy ? 0.5 : 1, cursor: !createName.trim() || createBusy ? 'default' : 'pointer' }}
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
    return (
      <div style={styles.page}>
        {renderCreateModal()}
        <div style={styles.header}>
          <h1 style={styles.pageTitle}>Beat Sheet</h1>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { setShowNewFolderInput(true); setNewFolderInputValue(''); }} style={styles.btnSecondary}>+ Folder</button>
            <button onClick={openCreateModal} style={styles.btnPrimary}>+ New Beat Sheet</button>
          </div>
        </div>

        {loading ? (
          <div style={styles.emptyState}>Loading...</div>
        ) : (
          <DragDropContext onDragEnd={handleLandingDragEnd}>
            {/* New folder inline input */}
            {showNewFolderInput && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                <input
                  autoFocus
                  value={newFolderInputValue}
                  onChange={e => setNewFolderInputValue(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleCreateFolder(); if (e.key === 'Escape') setShowNewFolderInput(false); }}
                  placeholder="Folder name..."
                  style={styles.input}
                />
                <button onClick={handleCreateFolder} style={styles.btnSmall}>Create</button>
                <button onClick={() => setShowNewFolderInput(false)} style={{ ...styles.actionBtn, color: 'rgba(255,255,255,0.4)' }}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M3 3l8 8M11 3l-8 8" />
                  </svg>
                </button>
              </div>
            )}

            {/* Draggable folders */}
            <Droppable droppableId="folder-list" type="FOLDER">
              {(folderListProvided) => (
                <div ref={folderListProvided.innerRef} {...folderListProvided.droppableProps}>
                  {dbFolders.map((folder, folderIndex) => {
                    const folderSheets = sheets.filter(s => s.folder === folder.id);
                    const isCollapsed = collapsedFolders.has(folder.id);
                    return (
                      <Draggable key={folder.id} draggableId={`folder-${folder.id}`} index={folderIndex}>
                        {(folderDragProvided, folderDragSnapshot) => (
                          <div
                            ref={folderDragProvided.innerRef}
                            {...folderDragProvided.draggableProps}
                            style={{ ...styles.folderSection, opacity: folderDragSnapshot.isDragging ? 0.85 : 1, ...folderDragProvided.draggableProps.style }}
                          >
                            <div style={styles.folderSectionHeader}>
                              <div {...folderDragProvided.dragHandleProps} style={styles.folderDragHandle} title="Drag to reorder">
                                <svg width="10" height="10" viewBox="0 0 12 12" fill="rgba(255,255,255,0.2)">
                                  <circle cx="4" cy="3" r="1.2"/><circle cx="8" cy="3" r="1.2"/>
                                  <circle cx="4" cy="6" r="1.2"/><circle cx="8" cy="6" r="1.2"/>
                                  <circle cx="4" cy="9" r="1.2"/><circle cx="8" cy="9" r="1.2"/>
                                </svg>
                              </div>
                              <button style={{ display: 'contents' }} onClick={() => toggleFolder(folder.id)}>
                                <svg
                                  width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"
                                  style={{ color: 'rgba(255,255,255,0.35)', transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.15s', flexShrink: 0 }}
                                >
                                  <path d="M2 3.5l3 3 3-3" />
                                </svg>
                                <svg width="14" height="14" viewBox="0 0 14 14" fill="#f59e0b" stroke="none" style={{ flexShrink: 0 }}>
                                  <path d="M1 3.5A1.5 1.5 0 012.5 2h2.379a1.5 1.5 0 011.06.44l.622.62a1.5 1.5 0 001.06.44H11.5A1.5 1.5 0 0113 5v5.5a1.5 1.5 0 01-1.5 1.5h-10A1.5 1.5 0 011 10.5v-7z"/>
                                </svg>
                              </button>
                              {renamingFolderId === folder.id ? (
                                <input
                                  autoFocus
                                  value={renameValue}
                                  onChange={e => setRenameValue(e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Enter') handleRenameFolder(folder.id); if (e.key === 'Escape') setRenamingFolderId(null); }}
                                  onBlur={() => handleRenameFolder(folder.id)}
                                  style={{ ...styles.input, flex: 1, padding: '2px 8px', fontSize: 13, fontWeight: 600 }}
                                />
                              ) : (
                                <span
                                  style={styles.folderSectionTitle}
                                  onDoubleClick={() => { setRenamingFolderId(folder.id); setRenameValue(folder.name); }}
                                >
                                  {folder.name}
                                </span>
                              )}
                              <span style={styles.folderCount}>{folderSheets.length}</span>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDeleteFolder(folder.id); }}
                                style={{ ...styles.actionBtn, padding: 2 }}
                                title="Delete folder"
                              >
                                <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                                  <path d="M3 3l8 8M11 3l-8 8" />
                                </svg>
                              </button>
                            </div>
                            {!isCollapsed && (
                              <Droppable droppableId={folder.id} type="SHEET">
                                {(provided, snapshot) => (
                                  <div
                                    ref={provided.innerRef}
                                    {...provided.droppableProps}
                                    style={{
                                      ...styles.folderDropZone,
                                      background: snapshot.isDraggingOver ? 'rgba(99,102,241,0.05)' : 'transparent',
                                      borderColor: snapshot.isDraggingOver ? 'rgba(99,102,241,0.35)' : 'rgba(255,255,255,0.05)',
                                      minHeight: folderSheets.length === 0 ? 52 : undefined,
                                    }}
                                  >
                                    {folderSheets.length === 0 && (
                                      <div style={styles.folderEmptyHint}>
                                        {snapshot.isDraggingOver ? 'Drop here' : 'Drag sheets here'}
                                      </div>
                                    )}
                                    {folderSheets.map((sheet, index) => (
                                      <Draggable key={sheet.id} draggableId={sheet.id} index={index}>
                                        {(provided, snapshot) => (
                                          <div
                                            ref={provided.innerRef}
                                            {...provided.draggableProps}
                                            style={{ ...styles.sheetCard, opacity: snapshot.isDragging ? 0.8 : 1, ...provided.draggableProps.style }}
                                          >
                                            <div {...provided.dragHandleProps} style={styles.sheetDragHandle} title="Drag to move to another folder">
                                              <svg width="12" height="12" viewBox="0 0 12 12" fill="rgba(255,255,255,0.25)">
                                                <circle cx="4" cy="3" r="1.2"/><circle cx="8" cy="3" r="1.2"/>
                                                <circle cx="4" cy="6" r="1.2"/><circle cx="8" cy="6" r="1.2"/>
                                                <circle cx="4" cy="9" r="1.2"/><circle cx="8" cy="9" r="1.2"/>
                                              </svg>
                                            </div>
                                            <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => openSheet(sheet)}>
                                              <div style={styles.sheetTitle}>{sheet.title}</div>
                                              <div style={styles.sheetMeta}>
                                                {countBeats(sheet.beats || [])} beat{countBeats(sheet.beats || []) !== 1 ? 's' : ''}
                                                {' \u00b7 '}{timeAgo(sheet.updated_at)}
                                              </div>
                                            </div>
                                            <div style={{ display: 'flex', gap: 6 }}>
                                              <button onClick={() => duplicateSheet(sheet)} style={styles.actionBtn} title="Duplicate">
                                                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                                                  <rect x="4" y="4" width="8" height="8" rx="1.5" />
                                                  <path d="M10 4V2.5A1.5 1.5 0 008.5 1h-6A1.5 1.5 0 001 2.5v6A1.5 1.5 0 002.5 10H4" />
                                                </svg>
                                              </button>
                                              <button onClick={() => archiveSheet(sheet.id)} style={styles.actionBtn} title="Archive">
                                                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                                                  <rect x="1" y="1" width="12" height="4" rx="1" />
                                                  <path d="M2 5v6a1 1 0 001 1h8a1 1 0 001-1V5M5.5 8h3" />
                                                </svg>
                                              </button>
                                              <button onClick={() => deleteSheet(sheet.id, sheet.title)} style={{ ...styles.actionBtn, color: '#ef4444' }} title="Delete">
                                                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                                                  <path d="M2 4h10M5 4V2.5a.5.5 0 01.5-.5h3a.5.5 0 01.5.5V4M11 4v7.5a1 1 0 01-1 1H4a1 1 0 01-1-1V4" />
                                                </svg>
                                              </button>
                                            </div>
                                          </div>
                                        )}
                                      </Draggable>
                                    ))}
                                    {provided.placeholder}
                                  </div>
                                )}
                              </Droppable>
                            )}
                          </div>
                        )}
                      </Draggable>
                    );
                  })}
                  {folderListProvided.placeholder}
                </div>
              )}
            </Droppable>

            {/* Unfiled */}
            {(() => {
              const unfiledSheets = sheets.filter(s => !s.folder);
              const isCollapsed = collapsedFolders.has('unfiled');
              return (
                <div style={styles.folderSection}>
                  <button style={styles.folderSectionHeader} onClick={() => toggleFolder('unfiled')}>
                    <svg
                      width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"
                      style={{ color: 'rgba(255,255,255,0.35)', transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.15s', flexShrink: 0 }}
                    >
                      <path d="M2 3.5l3 3 3-3" />
                    </svg>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="rgba(255,255,255,0.25)" stroke="none" style={{ flexShrink: 0 }}>
                      <path d="M1 3.5A1.5 1.5 0 012.5 2h2.379a1.5 1.5 0 011.06.44l.622.62a1.5 1.5 0 001.06.44H11.5A1.5 1.5 0 0113 5v5.5a1.5 1.5 0 01-1.5 1.5h-10A1.5 1.5 0 011 10.5v-7z"/>
                    </svg>
                    <span style={styles.folderSectionTitle}>Unfiled</span>
                    <span style={styles.folderCount}>{unfiledSheets.length}</span>
                  </button>
                  {!isCollapsed && (
                    <Droppable droppableId="unfiled" type="SHEET">
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          style={{
                            ...styles.folderDropZone,
                            background: snapshot.isDraggingOver ? 'rgba(99,102,241,0.05)' : 'transparent',
                            borderColor: snapshot.isDraggingOver ? 'rgba(99,102,241,0.35)' : 'rgba(255,255,255,0.05)',
                            minHeight: unfiledSheets.length === 0 ? 52 : undefined,
                          }}
                        >
                          {unfiledSheets.length === 0 && (
                            <div style={styles.folderEmptyHint}>
                              {snapshot.isDraggingOver ? 'Drop here' : 'No unfiled sheets'}
                            </div>
                          )}
                          {unfiledSheets.map((sheet, index) => (
                            <Draggable key={sheet.id} draggableId={sheet.id} index={index}>
                              {(provided, snapshot) => (
                                <div
                                  ref={provided.innerRef}
                                  {...provided.draggableProps}
                                  style={{ ...styles.sheetCard, opacity: snapshot.isDragging ? 0.8 : 1, ...provided.draggableProps.style }}
                                >
                                  <div {...provided.dragHandleProps} style={styles.sheetDragHandle} title="Drag to move to a folder">
                                    <svg width="12" height="12" viewBox="0 0 12 12" fill="rgba(255,255,255,0.25)">
                                      <circle cx="4" cy="3" r="1.2"/><circle cx="8" cy="3" r="1.2"/>
                                      <circle cx="4" cy="6" r="1.2"/><circle cx="8" cy="6" r="1.2"/>
                                      <circle cx="4" cy="9" r="1.2"/><circle cx="8" cy="9" r="1.2"/>
                                    </svg>
                                  </div>
                                  <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => openSheet(sheet)}>
                                    <div style={styles.sheetTitle}>{sheet.title}</div>
                                    <div style={styles.sheetMeta}>
                                      {countBeats(sheet.beats || [])} beat{countBeats(sheet.beats || []) !== 1 ? 's' : ''}
                                      {' \u00b7 '}{timeAgo(sheet.updated_at)}
                                    </div>
                                  </div>
                                  <div style={{ display: 'flex', gap: 6 }}>
                                    <button onClick={() => duplicateSheet(sheet)} style={styles.actionBtn} title="Duplicate">
                                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                                        <rect x="4" y="4" width="8" height="8" rx="1.5" />
                                        <path d="M10 4V2.5A1.5 1.5 0 008.5 1h-6A1.5 1.5 0 001 2.5v6A1.5 1.5 0 002.5 10H4" />
                                      </svg>
                                    </button>
                                    <button onClick={() => archiveSheet(sheet.id)} style={styles.actionBtn} title="Archive">
                                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                                        <rect x="1" y="1" width="12" height="4" rx="1" />
                                        <path d="M2 5v6a1 1 0 001 1h8a1 1 0 001-1V5M5.5 8h3" />
                                      </svg>
                                    </button>
                                    <button onClick={() => deleteSheet(sheet.id, sheet.title)} style={{ ...styles.actionBtn, color: '#ef4444' }} title="Delete">
                                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                                        <path d="M2 4h10M5 4V2.5a.5.5 0 01.5-.5h3a.5.5 0 01.5.5V4M11 4v7.5a1 1 0 01-1 1H4a1 1 0 01-1-1V4" />
                                      </svg>
                                    </button>
                                  </div>
                                </div>
                              )}
                            </Draggable>
                          ))}
                          {provided.placeholder}
                        </div>
                      )}
                    </Droppable>
                  )}
                </div>
              );
            })()}

            {/* Archive — always rendered last */}
            {(() => {
              const archiveSheets = sheets.filter(s => s.folder === 'archive');
              const isCollapsed = collapsedFolders.has('archive');
              return (
                <div style={styles.folderSection}>
                  <button style={styles.folderSectionHeader} onClick={() => toggleFolder('archive')}>
                    <svg
                      width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"
                      style={{ color: 'rgba(255,255,255,0.35)', transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.15s', flexShrink: 0 }}
                    >
                      <path d="M2 3.5l3 3 3-3" />
                    </svg>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="#f59e0b" stroke="none" style={{ flexShrink: 0 }}>
                      <path d="M1 3.5A1.5 1.5 0 012.5 2h2.379a1.5 1.5 0 011.06.44l.622.62a1.5 1.5 0 001.06.44H11.5A1.5 1.5 0 0113 5v5.5a1.5 1.5 0 01-1.5 1.5h-10A1.5 1.5 0 011 10.5v-7z"/>
                    </svg>
                    <span style={styles.folderSectionTitle}>{ARCHIVE_FOLDER.label}</span>
                    <span style={styles.folderCount}>{archiveSheets.length}</span>
                  </button>
                  {!isCollapsed && (
                    <Droppable droppableId="archive" type="SHEET">
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          style={{
                            ...styles.folderDropZone,
                            background: snapshot.isDraggingOver ? 'rgba(99,102,241,0.05)' : 'transparent',
                            borderColor: snapshot.isDraggingOver ? 'rgba(99,102,241,0.35)' : 'rgba(255,255,255,0.05)',
                            minHeight: archiveSheets.length === 0 ? 52 : undefined,
                          }}
                        >
                          {archiveSheets.length === 0 && (
                            <div style={styles.folderEmptyHint}>
                              {snapshot.isDraggingOver ? 'Drop here' : 'Drag sheets here'}
                            </div>
                          )}
                          {archiveSheets.map((sheet, index) => (
                            <Draggable key={sheet.id} draggableId={sheet.id} index={index}>
                              {(provided, snapshot) => (
                                <div
                                  ref={provided.innerRef}
                                  {...provided.draggableProps}
                                  style={{ ...styles.sheetCard, opacity: snapshot.isDragging ? 0.8 : 1, ...provided.draggableProps.style }}
                                >
                                  <div {...provided.dragHandleProps} style={styles.sheetDragHandle} title="Drag to move to another folder">
                                    <svg width="12" height="12" viewBox="0 0 12 12" fill="rgba(255,255,255,0.25)">
                                      <circle cx="4" cy="3" r="1.2"/><circle cx="8" cy="3" r="1.2"/>
                                      <circle cx="4" cy="6" r="1.2"/><circle cx="8" cy="6" r="1.2"/>
                                      <circle cx="4" cy="9" r="1.2"/><circle cx="8" cy="9" r="1.2"/>
                                    </svg>
                                  </div>
                                  <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => openSheet(sheet)}>
                                    <div style={styles.sheetTitle}>{sheet.title}</div>
                                    <div style={styles.sheetMeta}>
                                      {countBeats(sheet.beats || [])} beat{countBeats(sheet.beats || []) !== 1 ? 's' : ''}
                                      {' \u00b7 '}{timeAgo(sheet.updated_at)}
                                    </div>
                                  </div>
                                  <div style={{ display: 'flex', gap: 6 }}>
                                    <button onClick={() => duplicateSheet(sheet)} style={styles.actionBtn} title="Duplicate">
                                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                                        <rect x="4" y="4" width="8" height="8" rx="1.5" />
                                        <path d="M10 4V2.5A1.5 1.5 0 008.5 1h-6A1.5 1.5 0 001 2.5v6A1.5 1.5 0 002.5 10H4" />
                                      </svg>
                                    </button>
                                    <button onClick={() => archiveSheet(sheet.id)} style={styles.actionBtn} title="Archive">
                                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                                        <rect x="1" y="1" width="12" height="4" rx="1" />
                                        <path d="M2 5v6a1 1 0 001 1h8a1 1 0 001-1V5M5.5 8h3" />
                                      </svg>
                                    </button>
                                    <button onClick={() => deleteSheet(sheet.id, sheet.title)} style={{ ...styles.actionBtn, color: '#ef4444' }} title="Delete">
                                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                                        <path d="M2 4h10M5 4V2.5a.5.5 0 01.5-.5h3a.5.5 0 01.5.5V4M11 4v7.5a1 1 0 01-1 1H4a1 1 0 01-1-1V4" />
                                      </svg>
                                    </button>
                                  </div>
                                </div>
                              )}
                            </Draggable>
                          ))}
                          {provided.placeholder}
                        </div>
                      )}
                    </Droppable>
                  )}
                </div>
              );
            })()}
          </DragDropContext>
        )}
        {renderToast()}
      </div>
    );
  }

  // ── editor page ──
  return (
    <div style={styles.page}>
      {/* Top config bar */}
      <div style={styles.configBar}>
        <button onClick={closeEditor} style={styles.backBtn} title="Back to list">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M11 4L6 9l5 5" />
          </svg>
        </button>

        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Beat sheet title..."
          style={styles.titleInput}
        />

        <button onClick={openFolderBrowser} style={styles.folderBtn} title="Select Google Drive folder">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
            <path d="M1 3a1.5 1.5 0 011.5-1.5h2.879a1.5 1.5 0 011.06.44l.622.62a1.5 1.5 0 001.06.44H11.5A1.5 1.5 0 0113 4.5v6a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 011 10.5V3z"/>
          </svg>
          <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {driveFolderName || 'Select Folder'}
          </span>
        </button>

        <button
          onClick={pushBeatSheet}
          disabled={pushingSheet}
          style={{ ...styles.btnPrimary, opacity: pushingSheet ? 0.5 : 1 }}
        >
          {pushingSheet ? 'Pushing...' : 'Push Beat Sheet'}
        </button>

        <button
          onClick={pushScript}
          disabled={pushingScript}
          style={{ ...styles.btnSecondary, opacity: pushingScript ? 0.5 : 1 }}
        >
          {pushingScript ? 'Pushing...' : 'Push Script'}
        </button>

        <button
          onClick={findBrollAll}
          disabled={Object.keys(brollLoading).length > 0}
          style={{ ...styles.btnSecondary, opacity: Object.keys(brollLoading).length > 0 ? 0.5 : 1 }}
        >
          {Object.keys(brollLoading).length > 0 ? 'Finding B-Roll...' : 'Find B-Roll'}
        </button>

        <button onClick={openVersionHistory} style={styles.btnSecondary}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" style={{ marginRight: 6 }}>
            <circle cx="7" cy="7" r="5.5" />
            <path d="M7 4v3.5l2.5 1.5" />
          </svg>
          History
        </button>

        <div style={{ position: 'relative' }}>
          <button
            ref={templateBtnRef}
            onClick={() => { setShowTemplates(prev => !prev); if (!showTemplates) fetchTemplates(); }}
            style={styles.btnSecondary}
          >
            Templates
          </button>
          {showTemplates && (
            <div style={styles.templatesDropdown}>
              <button onClick={saveAsTemplate} style={styles.templatesSaveBtn}>
                Save as Template
              </button>
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', margin: '4px 0' }} />
              {templatesLoading ? (
                <div style={{ padding: '12px 16px', fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Loading...</div>
              ) : templates.length === 0 ? (
                <div style={{ padding: '12px 16px', fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>No templates yet</div>
              ) : (
                templates.map(t => (
                  <div key={t.id} style={styles.templateRow}>
                    <button onClick={() => loadTemplate(t)} style={styles.templateName}>
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

        <span style={styles.saveIndicator}>
          {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'unsaved' ? 'Unsaved' : 'Saved'}
        </span>
      </div>

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
        <Droppable droppableId="top-level" type="ITEMS">
          {(provided) => (
            <div ref={provided.innerRef} {...provided.droppableProps}>
              {beats.map((item, index) => {
                if (isSegment(item)) {
                  return (
                    <Draggable key={item.id} draggableId={item.id} index={index}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          style={{
                            ...styles.segmentContainer,
                            background: `${item.color || '#6366f1'}12`,
                            border: `1px solid ${item.color || '#6366f1'}30`,
                            borderLeft: `4px solid ${item.color || '#6366f1'}`,
                            ...(snapshot.isDragging ? { boxShadow: `0 8px 32px ${item.color || '#6366f1'}40` } : {}),
                            ...provided.draggableProps.style,
                          }}
                        >
                          {/* Segment header */}
                          <div
                            style={styles.segmentHeader}
                            onContextMenu={e => {
                              e.preventDefault();
                              setContextMenu({ x: e.clientX, y: e.clientY, segmentId: item.id, isSegmentHeader: true });
                            }}
                          >
                            <div {...provided.dragHandleProps} style={styles.dragHandle} title="Drag to reorder segment">
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
                              title={collapsedSegments.has(item.id) ? 'Expand segment' : 'Collapse segment'}
                            >
                              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={item.color || '#6366f1'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                                style={{ transform: collapsedSegments.has(item.id) ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.15s ease' }}>
                                <path d="M4 5l3 3 3-3" />
                              </svg>
                            </button>
                            <input
                              value={item.title}
                              onChange={e => updateSegment(item.id, 'title', e.target.value)}
                              placeholder="Segment title..."
                              style={{ ...styles.segmentTitleInput, color: item.color || '#6366f1' }}
                            />
                            <div style={{ position: 'relative' }}>
                              <button
                                onClick={() => setShowColorDropdown(prev => prev === item.id ? null : item.id)}
                                style={{ ...styles.colorDot, background: item.color || '#6366f1', width: 20, height: 20, flexShrink: 0 }}
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
                            {collapsedSegments.has(item.id) && (
                              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginLeft: 'auto', paddingRight: 8, flexShrink: 0 }}>
                                {item.children.length} beat{item.children.length !== 1 ? 's' : ''}
                              </span>
                            )}
                            <button onClick={() => deleteSegment(item.id)} style={styles.deleteBeatBtn} title="Delete segment">
                              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                                <path d="M2 4h10M5 4V2.5a.5.5 0 01.5-.5h3a.5.5 0 01.5.5V4M11 4v7.5a1 1 0 01-1 1H4a1 1 0 01-1-1V4" />
                              </svg>
                            </button>
                          </div>

                          {/* Segment beats */}
                          <Droppable droppableId={`segment-${item.id}`} type="ITEMS">
                            {(segProvided) => (
                              <div ref={segProvided.innerRef} {...segProvided.droppableProps} style={{ minHeight: collapsedSegments.has(item.id) ? 0 : 4, overflow: collapsedSegments.has(item.id) ? 'hidden' : undefined, maxHeight: collapsedSegments.has(item.id) ? 0 : undefined }}>
                                {!collapsedSegments.has(item.id) && item.children.map((beat, bIdx) => (
                                  <Draggable key={beat.id} draggableId={beat.id} index={bIdx}>
                                    {(bProvided, bSnapshot) => renderBeatRow(beat, bProvided, bSnapshot, item.id)}
                                  </Draggable>
                                ))}
                                {segProvided.placeholder}
                              </div>
                            )}
                          </Droppable>

                          {!collapsedSegments.has(item.id) && (
                            <button onClick={() => addBeatToSegment(item.id)} style={styles.addBeatInSegmentBtn}>+ Beat</button>
                          )}
                        </div>
                      )}
                    </Draggable>
                  );
                }

                // Top-level beat
                const beat = item;
                return (
                  <Draggable key={beat.id} draggableId={beat.id} index={index}>
                    {(provided, snapshot) => renderBeatRow(beat, provided, snapshot, null)}
                  </Draggable>
                );
              })}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>

      {/* Add beat / segment (bottom) */}
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 4, position: 'relative' }}>
        <div style={{ width: '20%', minWidth: 120, position: 'relative' }}>
          <button onClick={() => setShowAddMenuBottom(prev => !prev)} style={{ ...styles.addBeatBtn, width: '100%' }}>+ Add</button>
          {showAddMenuBottom && (
            <div data-add-menu style={{ ...styles.addMenuDropdown, bottom: '100%', top: 'auto', marginBottom: 6, marginTop: 0 }}>
              <button style={styles.addMenuItem} onClick={() => { addBeat(); setShowAddMenuBottom(false); }}>Beat</button>
              <button style={styles.addMenuItem} onClick={() => { addSegment(); setShowAddMenuBottom(false); }}>Segment</button>
            </div>
          )}
        </div>
      </div>

      {renderFolderBrowser()}
      {renderVersionHistory()}
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
    padding: '24px 32px',
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

  // ── editor ──
  configBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 20,
    flexWrap: 'wrap',
  },
  backBtn: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.5)',
    cursor: 'pointer',
    padding: 4,
    display: 'flex',
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
    background: 'rgba(99,102,241,0.12)',
    border: '1px solid rgba(99,102,241,0.2)',
    borderRadius: 6,
    padding: '4px 8px',
    width: 'fit-content',
    maxWidth: '100%',
  },
  tagText: {
    fontSize: 12,
    color: '#a5b4fc',
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
  tagColDrop: {
    background: 'rgba(99,102,241,0.08)',
    borderRadius: 8,
    outline: '2px dashed rgba(99,102,241,0.4)',
    outlineOffset: 2,
  },
  mediaThumb: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    background: 'rgba(99,102,241,0.08)',
    border: '1px solid rgba(99,102,241,0.15)',
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
    background: '#6366f1',
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
    background: '#1a1a2e',
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
    background: '#1e1e2e',
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
    color: '#6366f1',
  },
  colorDropdown: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: 6,
    background: '#1e1e2e',
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
  templatesDropdown: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: 6,
    background: '#1e1e2e',
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
    color: '#818cf8',
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
    background: 'rgba(99,102,241,0.15)',
    border: '1px solid rgba(99,102,241,0.4)',
  },
  createRadio: (active) => ({
    width: 14,
    height: 14,
    borderRadius: '50%',
    flexShrink: 0,
    border: active ? '4px solid #6366f1' : '2px solid rgba(255,255,255,0.25)',
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
    background: '#1e1e2e',
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

  // ── B-Roll suggestion styles ──
  brollCard: {
    width: '100%', padding: '8px 10px', background: 'rgba(99,102,241,0.06)',
    border: '1px solid rgba(99,102,241,0.15)', borderRadius: 8,
    display: 'flex', flexDirection: 'column', gap: 4, position: 'relative',
  },
  brollCategory: {
    fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
    padding: '2px 6px', borderRadius: 4,
  },
  brollSource: {
    fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
    padding: '2px 6px', borderRadius: 4,
  },
  brollTitle: {
    fontSize: 12, fontWeight: 600, color: '#a5b4fc', textDecoration: 'none',
    lineHeight: 1.4, wordBreak: 'break-word',
  },
  brollDesc: {
    fontSize: 11, color: 'rgba(255,255,255,0.4)', lineHeight: 1.3,
    overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
  },
  brollBtn: {
    display: 'flex', alignItems: 'center', gap: 5, background: 'none',
    border: '1px dashed rgba(99,102,241,0.3)', borderRadius: 6,
    color: 'rgba(165,180,252,0.6)', fontSize: 11, padding: '4px 8px',
    cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", marginTop: 4, width: '100%',
    justifyContent: 'center',
  },
};
