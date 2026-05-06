import React, { useState, useEffect, useRef, useCallback } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../contexts/ConfirmContext';

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;

// ─── helpers ───────────────────────────────────────────────────────────────────

function newBeat() {
  return { id: crypto.randomUUID(), title: '', context: '', graphics: [], videos: [] };
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

const FOLDERS = [
  { id: 'mayday', label: 'Mayday' },
  { id: 'tm_baseball', label: 'TM Baseball' },
  { id: 'ideas', label: 'Ideas' },
];
const ARCHIVE_FOLDER = { id: 'archive', label: 'Archive' };

// ─── component ─────────────────────────────────────────────────────────────────

export default function Production() {
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

  // ── confirm delete ──
  const [confirmDelete, setConfirmDelete] = useState(null);

  // ── folder sections ──
  const [collapsedFolders, setCollapsedFolders] = useState(new Set(['ideas', 'archive', 'unfiled']));

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
  const createSheet = async () => {
    const name = prompt('Beat sheet name:');
    if (!name || !name.trim()) return;
    const { data, error } = await supabase
      .from('beat_sheets')
      .insert({ user_id: profile.id, title: name.trim(), beats: [newBeat()] })
      .select()
      .single();
    if (error) { console.error(error); return; }
    openSheet(data);
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
    setExpandedContexts(new Set(loadedBeats.filter(b => b.context).map(b => b.id)));
  };

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
      beat_count: (snapshotBeats || []).length,
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
    setExpandedContexts(new Set((version.beats || []).filter(b => b.context).map(b => b.id)));
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
    setBeats(prev => prev.map(b => b.id === beatId ? { ...b, [field]: value } : b));
  };

  const deleteBeat = (beatId) => {
    setBeats(prev => prev.filter(b => b.id !== beatId));
  };

  const addTag = (beatId, field, value) => {
    if (!value.trim()) return;
    setBeats(prev => prev.map(b =>
      b.id === beatId ? { ...b, [field]: [...b[field], value.trim()] } : b
    ));
  };

  const removeTag = (beatId, field, index) => {
    setBeats(prev => prev.map(b =>
      b.id === beatId ? { ...b, [field]: b[field].filter((_, i) => i !== index) } : b
    ));
  };

  const autoResize = (el) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  };

  const reorderTag = (beatId, field, fromIndex, toIndex) => {
    setBeats(prev => prev.map(b => {
      if (b.id !== beatId) return b;
      const arr = [...b[field]];
      const [moved] = arr.splice(fromIndex, 1);
      arr.splice(toIndex, 0, moved);
      return { ...b, [field]: arr };
    }));
  };

  const moveTagAcrossBeats = (fromBeatId, field, fromIndex, toBeatId) => {
    setBeats(prev => {
      const fromBeat = prev.find(b => b.id === fromBeatId);
      if (!fromBeat) return prev;
      const item = fromBeat[field][fromIndex];
      return prev.map(b => {
        if (b.id === fromBeatId) return { ...b, [field]: b[field].filter((_, i) => i !== fromIndex) };
        if (b.id === toBeatId) return { ...b, [field]: [...b[field], item] };
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
      setBeats(prev => prev.map(b =>
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

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    const reordered = Array.from(beats);
    const [moved] = reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, moved);
    setBeats(reordered);
  };

  const toggleFolder = (folderId) => {
    setCollapsedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  const handleSheetDragEnd = async (result) => {
    if (!result.destination) return;
    const { draggableId: sheetId, source, destination } = result;
    if (source.droppableId === destination.droppableId) return;
    const newFolder = destination.droppableId === 'unfiled' ? null : destination.droppableId;
    setSheets(prev => prev.map(s => s.id === sheetId ? { ...s, folder: newFolder } : s));
    await supabase.from('beat_sheets').update({ folder: newFolder }).eq('id', sheetId);
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
        body: JSON.stringify({ folderId: driveFolderId, title, beats }),
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

      const cueStyle = 'opacity:0.4; font-size:0.7em; letter-spacing:0.08em; text-transform:uppercase; margin:0.3em 0;';
      const divider = '<div style="border-top:1px solid rgba(255,255,255,0.12); margin:1.8em 0;"></div>';

      // Build HTML: graphics cues, beat content (no context), video cues
      const htmlParts = beats
        .filter(b => b.title.trim())
        .map(b => {
          const parts = [];
          if (b.graphics?.length > 0)
            parts.push(`<p style="${cueStyle}">${b.graphics.map(g => `[ ${g} ]`).join('  ')}</p>`);
          parts.push(textToHtml(b.title));
          if (b.videos?.length > 0)
            parts.push(`<p style="${cueStyle}">${b.videos.map(v => `[ ${v} ]`).join('  ')}</p>`);
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
                  {(previewVersion.beats || []).map((beat, i) => (
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
                  ))}
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

  // ── landing page ──
  if (!activeSheet) {
    return (
      <div style={styles.page}>
        <div style={styles.header}>
          <h1 style={styles.pageTitle}>Beat Sheet</h1>
          <button onClick={createSheet} style={styles.btnPrimary}>+ New Beat Sheet</button>
        </div>

        {loading ? (
          <div style={styles.emptyState}>Loading...</div>
        ) : (
          <DragDropContext onDragEnd={handleSheetDragEnd}>
            {FOLDERS.map(folder => {
              const folderSheets = sheets.filter(s => s.folder === folder.id);
              const isCollapsed = collapsedFolders.has(folder.id);
              return (
                <div key={folder.id} style={styles.folderSection}>
                  <button style={styles.folderSectionHeader} onClick={() => toggleFolder(folder.id)}>
                    <svg
                      width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"
                      style={{ color: 'rgba(255,255,255,0.35)', transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.15s', flexShrink: 0 }}
                    >
                      <path d="M2 3.5l3 3 3-3" />
                    </svg>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="#f59e0b" stroke="none" style={{ flexShrink: 0 }}>
                      <path d="M1 3.5A1.5 1.5 0 012.5 2h2.379a1.5 1.5 0 011.06.44l.622.62a1.5 1.5 0 001.06.44H11.5A1.5 1.5 0 0113 5v5.5a1.5 1.5 0 01-1.5 1.5h-10A1.5 1.5 0 011 10.5v-7z"/>
                    </svg>
                    <span style={styles.folderSectionTitle}>{folder.label}</span>
                    <span style={styles.folderCount}>{folderSheets.length}</span>
                  </button>
                  {!isCollapsed && (
                    <Droppable droppableId={folder.id}>
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
                                      {(sheet.beats || []).length} beat{(sheet.beats || []).length !== 1 ? 's' : ''}
                                      {' \u00b7 '}{timeAgo(sheet.updated_at)}
                                    </div>
                                  </div>
                                  <div style={{ display: 'flex', gap: 6 }}>
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
            })}

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
                    <Droppable droppableId="unfiled">
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
                                      {(sheet.beats || []).length} beat{(sheet.beats || []).length !== 1 ? 's' : ''}
                                      {' \u00b7 '}{timeAgo(sheet.updated_at)}
                                    </div>
                                  </div>
                                  <div style={{ display: 'flex', gap: 6 }}>
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
                    <Droppable droppableId="archive">
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
                                      {(sheet.beats || []).length} beat{(sheet.beats || []).length !== 1 ? 's' : ''}
                                      {' \u00b7 '}{timeAgo(sheet.updated_at)}
                                    </div>
                                  </div>
                                  <div style={{ display: 'flex', gap: 6 }}>
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

        <button onClick={openVersionHistory} style={styles.btnSecondary}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" style={{ marginRight: 6 }}>
            <circle cx="7" cy="7" r="5.5" />
            <path d="M7 4v3.5l2.5 1.5" />
          </svg>
          History
        </button>

        <span style={styles.saveIndicator}>
          {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'unsaved' ? 'Unsaved' : 'Saved'}
        </span>
      </div>

      {/* Column headers */}
      <div style={styles.columnHeaders}>
        <div style={styles.colHeaderLeft}>Beat / Context</div>
        <div style={styles.colHeader}>Graphics</div>
        <div style={styles.colHeader}>Videos</div>
        <div style={{ width: 36 }} />
      </div>

      {/* Beat rows */}
      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable droppableId="beats">
          {(provided) => (
            <div ref={provided.innerRef} {...provided.droppableProps}>
              {beats.map((beat, index) => (
                <Draggable key={beat.id} draggableId={beat.id} index={index}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.draggableProps}
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
                          const isMedia = typeof g === 'object' && g.url;
                          if (isMedia) {
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
                          const isMedia = typeof v === 'object' && v.url;
                          if (isMedia) {
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
                      </div>

                      {/* Delete beat */}
                      <button onClick={() => deleteBeat(beat.id)} style={styles.deleteBeatBtn} title="Delete beat">
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M2 4h10M5 4V2.5a.5.5 0 01.5-.5h3a.5.5 0 01.5.5V4M11 4v7.5a1 1 0 01-1 1H4a1 1 0 01-1-1V4" />
                        </svg>
                      </button>
                    </div>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>

      {/* Add beat */}
      <button onClick={addBeat} style={styles.addBeatBtn}>+ Beat</button>

      {renderFolderBrowser()}
      {renderVersionHistory()}
      {renderToast()}
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
};
