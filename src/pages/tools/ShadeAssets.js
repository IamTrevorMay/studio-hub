import React, { useState, useEffect, useRef, useCallback } from 'react';
import { zipSync } from 'fflate';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import usePersistedTab from '../../hooks/usePersistedTab';
import backdropDismiss from '../../lib/backdropDismiss';

// Assets view of the Asset Search tool — folder browsing + AI index search
// over the Shade drive via the shade-search edge function. Default view
// browses the drive's folders (drill-in with breadcrumbs); a query narrows
// recursively within the browsed folder. Mirrors the Pitches view's
// layout and conventions: left panel with the Search/Playlist toggle on
// top, then the query + type filters (or playlist picker); results table
// on the right. Personal playlists (asset_playlists + asset_playlist_items,
// RLS owner-only, items snapshot the asset as jsonb), review modal that
// walks a queue, and bulk download bundled into a client-side zip
// (browsers block programmatic downloads after the first without user
// activation).
//
// Playback/previews use Shade signed URLs (fine as media src); download
// bytes stream through the edge function because the storage host's CORS
// isn't ours to configure.
//
// Upload to Drive reuses the Pitches view's plumbing: pitch-video-drive
// lists/creates folders under the shared root, drive-upload-init opens a
// resumable session, and the browser PUTs the bytes (fetched from Shade
// via the edge function) straight to Drive.

const FN_URL = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/shade-search`;
const DRIVE_FN_URL = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/pitch-video-drive`;
const UPLOAD_INIT_URL = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/drive-upload-init`;
const DRIVE_ROOT = { id: '1evC6T-cSra_KF89QzQ0KhDeXR5a4a2g1', name: 'Pitch Videos' };

const TYPE_FILTERS = [
  { key: 'VIDEO', label: 'Videos' },
  { key: 'IMAGE', label: 'Images' },
  { key: 'AUDIO', label: 'Audio' },
  { key: 'DOCUMENT', label: 'Docs' },
];

const TYPE_ICONS = { VIDEO: '🎬', IMAGE: '🖼️', AUDIO: '🎧', DOCUMENT: '📄' };

function typeIcon(type) {
  return TYPE_ICONS[String(type || '').toUpperCase()] || '📦';
}

function fmtSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function fmtDate(iso) {
  return iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
}

function downloadName(asset) {
  const name = asset.name || 'asset';
  const ext = asset.extension ? String(asset.extension).replace(/^\./, '') : '';
  if (ext && !name.toLowerCase().endsWith(`.${ext.toLowerCase()}`)) return `${name}.${ext}`;
  return name;
}

const MIME_BY_EXT = {
  mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', webm: 'video/webm', mkv: 'video/x-matroska',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac',
  pdf: 'application/pdf',
};

function assetMime(asset) {
  const ext = String(asset.extension || downloadName(asset).split('.').pop() || '')
    .replace(/^\./, '')
    .toLowerCase();
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

// Walk an arbitrary Shade drives/workspaces response and collect anything
// that looks like a drive: an object with a uuid id and a name.
function collectDrives(node, out = [], depth = 0) {
  if (!node || depth > 6) return out;
  if (Array.isArray(node)) {
    node.forEach((n) => collectDrives(n, out, depth + 1));
    return out;
  }
  if (typeof node === 'object') {
    if (typeof node.id === 'string' && /^[0-9a-f-]{32,36}$/i.test(node.id) && (node.name || node.title)) {
      out.push({ id: node.id, name: node.name || node.title });
    }
    Object.values(node).forEach((v) => collectDrives(v, out, depth + 1));
  }
  return out;
}

export default function ShadeAssets() {
  const { profile } = useAuth();

  const [view, setView] = usePersistedTab('shade-assets-view', 'search', ['search', 'playlist']); // 'search' | 'playlist'
  const [query, setQuery] = useState('');
  const [types, setTypes] = useState([]); // empty = everything
  const [assets, setAssets] = useState(null); // null = not searched yet
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [driveHelp, setDriveHelp] = useState(null); // [{id, name}] when drive_id is wrong

  // Folder browsing (default view; search narrows within the browsed folder)
  const [browsePath, setBrowsePath] = useState('/');
  const [browse, setBrowse] = useState(null); // { folders, assets } for browsePath
  const [browseLoading, setBrowseLoading] = useState(false);

  const [selectedIds, setSelectedIds] = useState(() => new Set());

  // Review modal: { list: [asset...], index }
  const [modal, setModal] = useState(null);
  const [resolved, setResolved] = useState({}); // asset id → signed url | null

  // Playlists (owner-only, mirror of pitch playlists)
  const [playlists, setPlaylists] = useState([]);
  const [activePlaylistId, setActivePlaylistId] = useState(null);
  const [playlistItems, setPlaylistItems] = useState([]);
  const [playlistLoading, setPlaylistLoading] = useState(false);
  const [addPicker, setAddPicker] = useState(null); // { assets } → picker modal
  const [newPlaylistName, setNewPlaylistName] = useState('');

  const [batch, setBatch] = useState(null); // { done, total, failed }
  const batchCancelRef = useRef(false);

  // Upload-to-Drive picker (mirrors the Pitches view's flow)
  const [drivePicker, setDrivePicker] = useState(null); // { assets: [asset...] }
  const [drivePath, setDrivePath] = useState([DRIVE_ROOT]); // breadcrumb
  const [driveFolders, setDriveFolders] = useState([]);
  const [driveLoading, setDriveLoading] = useState(false);
  const [driveError, setDriveError] = useState(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [uploadState, setUploadState] = useState(null); // { done, total, failed, current }

  const callFn = useCallback(async (body, raw = false) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated');
    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (raw) return res;
    const json = await res.json().catch(() => ({}));
    if (res.status === 503) {
      setNotConfigured(true);
      throw new Error(json.error || 'Shade integration not configured');
    }
    if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
    return json;
  }, []);

  // A wrong SHADE_DRIVE_ID comes back as "Drive not found" — list what
  // the API key can actually see so the secret can be corrected.
  const noteShadeError = useCallback(async (err) => {
    setSearchError(err.message);
    if (/drive not found/i.test(err.message)) {
      try {
        const json = await callFn({ op: 'drives' });
        const found = collectDrives(json);
        const seen = new Set();
        setDriveHelp(found.filter((d) => !seen.has(d.id) && seen.add(d.id)));
      } catch { /* leave driveHelp null */ }
    }
  }, [callFn]);

  // ─── Browse (default folder view) ─────────────────────────────────────────
  const loadBrowse = useCallback(async (path) => {
    setBrowseLoading(true);
    setSearchError(null);
    setDriveHelp(null);
    try {
      const json = await callFn({ op: 'browse', path });
      setBrowse({ folders: json.folders || [], assets: json.assets || [] });
    } catch (err) {
      setBrowse({ folders: [], assets: [] });
      await noteShadeError(err);
    } finally {
      setBrowseLoading(false);
    }
  }, [callFn, noteShadeError]);

  useEffect(() => { loadBrowse('/'); }, [loadBrowse]);

  // Navigating always drops back out of search results into browsing.
  const openFolder = (path) => {
    setAssets(null);
    setQuery('');
    setSelectedIds(new Set());
    setBrowsePath(path);
    loadBrowse(path);
  };

  // ─── Search (narrows within the browsed folder, recursive) ────────────────
  const runSearch = async (e) => {
    if (e) e.preventDefault();
    if (searching) return;
    if (!query.trim()) { setAssets(null); setSearchError(null); return; } // empty query = back to browsing
    setSearching(true);
    setSearchError(null);
    setDriveHelp(null);
    setSelectedIds(new Set());
    try {
      const json = await callFn({ op: 'search', query, types, limit: 100, path: browsePath });
      setAssets(json.assets || []);
    } catch (err) {
      setAssets([]);
      await noteShadeError(err);
    } finally {
      setSearching(false);
    }
  };

  const toggleType = (key) => {
    setTypes((ts) => (ts.includes(key) ? ts.filter((t) => t !== key) : [...ts, key]));
  };

  const toggleSelected = (id) => {
    setSelectedIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Type chips filter browse listings client-side (search applies them server-side).
  const browseAssets = (browse?.assets || []).filter(
    (a) => types.length === 0 || types.includes(String(a.type || '').toUpperCase())
  );
  const visibleAssets = assets !== null ? assets : browseAssets;
  const selectedAssets = visibleAssets.filter((a) => selectedIds.has(a.id));

  const crumbs = [
    { name: 'All Assets', path: '/' },
    ...browsePath.split('/').filter(Boolean).map((seg, i, arr) => ({
      name: seg,
      path: `/${arr.slice(0, i + 1).join('/')}`,
    })),
  ];

  // ─── Signed URL resolution (cached per asset) ─────────────────────────────
  const resolveAsset = useCallback(async (asset) => {
    if (resolved[asset.id] !== undefined) return resolved[asset.id];
    try {
      const json = await callFn({ op: 'resolve', asset_id: asset.id, proxy_id: asset.proxy_id });
      const url = json.url || null;
      setResolved((m) => ({ ...m, [asset.id]: url }));
      return url;
    } catch {
      setResolved((m) => ({ ...m, [asset.id]: null }));
      return null;
    }
  }, [callFn, resolved]);

  // Pre-resolve the asset shown in the modal.
  const modalAsset = modal ? modal.list[modal.index] : null;
  useEffect(() => {
    if (modalAsset && resolved[modalAsset.id] === undefined) resolveAsset(modalAsset);
  }, [modalAsset, resolved, resolveAsset]);

  useEffect(() => {
    if (!modal) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setModal(null);
      if (e.key === 'ArrowRight') setModal((m) => m && ({ ...m, index: Math.min(m.index + 1, m.list.length - 1) }));
      if (e.key === 'ArrowLeft') setModal((m) => m && ({ ...m, index: Math.max(m.index - 1, 0) }));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal]);

  // ─── Downloads ────────────────────────────────────────────────────────────
  const fetchAssetBytes = async (asset) => {
    try {
      const res = await callFn({ op: 'fetch', asset_id: asset.id, proxy_id: asset.proxy_id }, true);
      if (!res.ok) return null;
      return new Uint8Array(await res.arrayBuffer());
    } catch {
      return null;
    }
  };

  const saveBlob = (blob, name) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const downloadAsset = async (asset) => {
    setBatch({ done: 0, total: 1, failed: 0 });
    const bytes = await fetchAssetBytes(asset);
    if (bytes) saveBlob(new Blob([bytes]), downloadName(asset));
    else alert('Could not download this asset — Shade has no rendition for it yet.');
    setBatch(null);
  };

  const runBatchDownload = async (targets) => {
    if (!targets.length) return;
    if (targets.length === 1) { await downloadAsset(targets[0]); return; }
    batchCancelRef.current = false;
    setBatch({ done: 0, total: targets.length, failed: 0 });
    const files = {};
    for (let i = 0; i < targets.length; i++) {
      if (batchCancelRef.current) { setBatch(null); return; }
      const bytes = await fetchAssetBytes(targets[i]);
      if (bytes) {
        let name = downloadName(targets[i]);
        if (files[name]) {
          const dot = name.lastIndexOf('.');
          const base = dot > 0 ? name.slice(0, dot) : name;
          const ext = dot > 0 ? name.slice(dot) : '';
          let n = 2;
          while (files[`${base} (${n})${ext}`]) n++;
          name = `${base} (${n})${ext}`;
        }
        files[name] = [bytes, { level: 0 }];
      }
      setBatch((b) => b && ({ ...b, done: i + 1, failed: b.failed + (bytes ? 0 : 1) }));
    }
    if (Object.keys(files).length > 0) {
      const blob = new Blob([zipSync(files)], { type: 'application/zip' });
      saveBlob(blob, `assets-${new Date().toISOString().slice(0, 10)}.zip`);
    }
    setBatch(null);
  };

  // ─── Upload to Drive ──────────────────────────────────────────────────────
  const loadDriveFolders = useCallback(async (parentId) => {
    setDriveLoading(true);
    setDriveError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${DRIVE_FN_URL}?parentId=${encodeURIComponent(parentId)}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Folder list failed (${res.status})`);
      setDriveFolders(json.folders || []);
    } catch (err) {
      setDriveError(err.message || 'Failed to list folders');
      setDriveFolders([]);
    } finally {
      setDriveLoading(false);
    }
  }, []);

  const openDrivePicker = (targets) => {
    if (!targets.length) return;
    setDrivePicker({ assets: targets });
    setDrivePath([DRIVE_ROOT]);
    setNewFolderName('');
    setUploadState(null);
    setDriveError(null);
    loadDriveFolders(DRIVE_ROOT.id);
  };

  const enterDriveFolder = (folder) => {
    setDrivePath((p) => [...p, folder]);
    loadDriveFolders(folder.id);
  };

  const jumpToDriveCrumb = (idx) => {
    const next = drivePath.slice(0, idx + 1);
    setDrivePath(next);
    loadDriveFolders(next[next.length - 1].id);
  };

  const createDriveFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    setCreatingFolder(true);
    setDriveError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const parentId = drivePath[drivePath.length - 1].id;
      const res = await fetch(DRIVE_FN_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentId, name }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Create failed (${res.status})`);
      setNewFolderName('');
      enterDriveFolder(json.folder);
    } catch (err) {
      setDriveError(err.message || 'Failed to create folder');
    } finally {
      setCreatingFolder(false);
    }
  };

  const uploadToDrive = async () => {
    if (!drivePicker) return;
    const targets = drivePicker.assets;
    const parentFolderId = drivePath[drivePath.length - 1].id;
    const { data: { session } } = await supabase.auth.getSession();
    setUploadState({ done: 0, total: targets.length, failed: 0, current: '' });

    for (let i = 0; i < targets.length; i++) {
      const asset = targets[i];
      const filename = downloadName(asset);
      setUploadState((u) => u && ({ ...u, current: filename }));
      try {
        const bytes = await fetchAssetBytes(asset);
        if (!bytes) throw new Error('no rendition');
        const mimeType = assetMime(asset);

        const initRes = await fetch(UPLOAD_INIT_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename, parentFolderId, mimeType, sizeBytes: bytes.length }),
        });
        const initJson = await initRes.json().catch(() => ({}));
        if (!initRes.ok || !initJson.uploadUrl) {
          throw new Error(initJson.error || `Upload init failed (${initRes.status})`);
        }

        const putRes = await fetch(initJson.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': mimeType },
          body: new Blob([bytes], { type: mimeType }),
        });
        if (!putRes.ok) throw new Error(`Drive PUT ${putRes.status}`);
        setUploadState((u) => u && ({ ...u, done: i + 1 }));
      } catch (err) {
        setUploadState((u) => u && ({ ...u, done: i + 1, failed: u.failed + 1 }));
      }
    }
    setUploadState((u) => u && ({ ...u, current: '' }));
  };

  // ─── Playlists ────────────────────────────────────────────────────────────
  const fetchPlaylists = useCallback(async () => {
    const { data, error } = await supabase
      .from('asset_playlists')
      .select('*, asset_playlist_items(count)')
      .order('updated_at', { ascending: false });
    if (error) { console.error('Error fetching asset playlists:', error); return; }
    setPlaylists(data || []);
  }, []);

  useEffect(() => {
    if (profile?.id) fetchPlaylists();
  }, [profile?.id, fetchPlaylists]);

  const fetchPlaylistItems = useCallback(async (playlistId) => {
    if (!playlistId) { setPlaylistItems([]); return; }
    setPlaylistLoading(true);
    const { data, error } = await supabase
      .from('asset_playlist_items')
      .select('*')
      .eq('playlist_id', playlistId)
      .order('position');
    if (error) console.error('Error fetching asset playlist items:', error);
    setPlaylistItems(data || []);
    setPlaylistLoading(false);
  }, []);

  useEffect(() => {
    fetchPlaylistItems(activePlaylistId);
  }, [activePlaylistId, fetchPlaylistItems]);

  const createPlaylist = async (name) => {
    const { data, error } = await supabase
      .from('asset_playlists')
      .insert({ name, created_by: profile.id })
      .select()
      .single();
    if (error) { console.error('Error creating asset playlist:', error); return null; }
    fetchPlaylists();
    return data;
  };

  const addAssetsToPlaylist = async (playlistId, assetsToAdd) => {
    try {
      const { data: existing } = await supabase
        .from('asset_playlist_items')
        .select('asset_key, position')
        .eq('playlist_id', playlistId);
      const have = new Set((existing || []).map((r) => r.asset_key));
      let pos = (existing || []).reduce((m, r) => Math.max(m, r.position), -1) + 1;
      const payload = assetsToAdd
        .filter((a) => !have.has(a.id))
        .map((a) => ({ playlist_id: playlistId, asset_key: a.id, asset: a, position: pos++ }));
      if (payload.length > 0) {
        const { error } = await supabase.from('asset_playlist_items').insert(payload);
        if (error) throw error;
        await supabase.from('asset_playlists')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', playlistId);
      }
      fetchPlaylists();
      if (playlistId === activePlaylistId) fetchPlaylistItems(playlistId);
      setAddPicker(null);
      setSelectedIds(new Set());
    } catch (err) {
      console.error('Error adding to asset playlist:', err);
      alert('Could not add assets to the playlist.');
    }
  };

  const removePlaylistItem = async (itemId) => {
    await supabase.from('asset_playlist_items').delete().eq('id', itemId);
    fetchPlaylistItems(activePlaylistId);
    fetchPlaylists();
  };

  const renamePlaylist = async (playlistId) => {
    const pl = playlists.find((p) => p.id === playlistId);
    const name = window.prompt('Rename playlist', pl?.name || '');
    if (!name || !name.trim()) return;
    await supabase.from('asset_playlists')
      .update({ name: name.trim(), updated_at: new Date().toISOString() })
      .eq('id', playlistId);
    fetchPlaylists();
  };

  const deletePlaylist = async (playlistId) => {
    const pl = playlists.find((p) => p.id === playlistId);
    if (!window.confirm(`Delete playlist "${pl?.name || ''}" and its queue?`)) return;
    await supabase.from('asset_playlists').delete().eq('id', playlistId);
    if (activePlaylistId === playlistId) setActivePlaylistId(null);
    fetchPlaylists();
  };

  const activePlaylist = playlists.find((p) => p.id === activePlaylistId);
  const playlistAssets = playlistItems.map((it) => it.asset);

  // ─── Render pieces ────────────────────────────────────────────────────────
  const renderViewToggle = () => (
    <div style={styles.viewTabs}>
      <button
        style={{ ...styles.viewTab, ...(view === 'search' ? styles.viewTabOn : null) }}
        onClick={() => setView('search')}
      >
        Search
      </button>
      <button
        style={{ ...styles.viewTab, ...(view === 'playlist' ? styles.viewTabOn : null) }}
        onClick={() => setView('playlist')}
      >
        Playlist
      </button>
    </div>
  );

  const renderModal = () => {
    if (!modal || !modalAsset) return null;
    const url = resolved[modalAsset.id];
    const kind = String(modalAsset.type || '').toUpperCase();
    return (
      <div style={styles.modalOverlay} {...backdropDismiss(() => setModal(null))}>
        <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
          <div style={styles.modalHead}>
            <span style={{ fontSize: '15px', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {typeIcon(kind)} {modalAsset.name}
            </span>
            <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.35)' }}>
              {modal.index + 1} / {modal.list.length}
            </span>
            <div style={{ flex: 1 }} />
            <button style={styles.modalBtn} onClick={() => downloadAsset(modalAsset)}>Download</button>
            <button style={styles.modalBtn} onClick={() => openDrivePicker([modalAsset])}>Upload to Drive</button>
            <button style={styles.modalClose} onClick={() => setModal(null)}>✕</button>
          </div>
          <div style={styles.modalBody}>
            {url === undefined && <div style={styles.modalMsg}>Loading…</div>}
            {url === null && <div style={styles.modalMsg}>No preview available for this asset.</div>}
            {url && kind === 'VIDEO' && (
              <video key={modalAsset.id} src={url} controls autoPlay style={styles.modalMedia} />
            )}
            {url && kind === 'IMAGE' && (
              <img key={modalAsset.id} src={url} alt={modalAsset.name} style={styles.modalMedia} />
            )}
            {url && kind === 'AUDIO' && (
              <audio key={modalAsset.id} src={url} controls autoPlay style={{ width: '90%' }} />
            )}
            {url && kind !== 'VIDEO' && kind !== 'IMAGE' && kind !== 'AUDIO' && (
              <div style={styles.modalMsg}>
                <div style={{ fontSize: '44px', marginBottom: '10px' }}>{typeIcon(kind)}</div>
                No inline preview for this file type — use Download.
              </div>
            )}
          </div>
          <div style={styles.modalNav}>
            <button
              style={{ ...styles.modalBtn, opacity: modal.index === 0 ? 0.35 : 1 }}
              disabled={modal.index === 0}
              onClick={() => setModal((m) => ({ ...m, index: m.index - 1 }))}
            >← Prev</button>
            <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.35)', alignSelf: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {modalAsset.path}
            </span>
            <button
              style={{ ...styles.modalBtn, opacity: modal.index >= modal.list.length - 1 ? 0.35 : 1 }}
              disabled={modal.index >= modal.list.length - 1}
              onClick={() => setModal((m) => ({ ...m, index: m.index + 1 }))}
            >Next →</button>
          </div>
        </div>
      </div>
    );
  };

  const renderAddPicker = () => {
    if (!addPicker) return null;
    return (
      <div style={styles.modalOverlay} {...backdropDismiss(() => setAddPicker(null))}>
        <div style={{ ...styles.modal, maxWidth: '400px' }} onClick={(e) => e.stopPropagation()}>
          <div style={styles.modalHead}>
            <span style={{ fontSize: '15px', fontWeight: 700 }}>
              Add {addPicker.assets.length} asset{addPicker.assets.length === 1 ? '' : 's'} to playlist
            </span>
            <div style={{ flex: 1 }} />
            <button style={styles.modalClose} onClick={() => setAddPicker(null)}>✕</button>
          </div>
          <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '320px', overflowY: 'auto' }}>
            {playlists.map((pl) => (
              <button key={pl.id} style={styles.pickerRow} onClick={() => addAssetsToPlaylist(pl.id, addPicker.assets)}>
                <span>{pl.name}</span>
                <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: '12px' }}>
                  {pl.asset_playlist_items?.[0]?.count ?? 0} items
                </span>
              </button>
            ))}
            {playlists.length === 0 && (
              <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: '13px', padding: '4px 2px' }}>No playlists yet.</div>
            )}
            <form
              style={{ display: 'flex', gap: '6px', marginTop: '8px' }}
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newPlaylistName.trim()) return;
                const pl = await createPlaylist(newPlaylistName.trim());
                setNewPlaylistName('');
                if (pl) addAssetsToPlaylist(pl.id, addPicker.assets);
              }}
            >
              <input
                value={newPlaylistName}
                onChange={(e) => setNewPlaylistName(e.target.value)}
                placeholder="New playlist name…"
                style={{ ...styles.input, flex: 1 }}
              />
              <button type="submit" style={{ ...styles.primaryBtn, flex: 'none', padding: '8px 14px' }}>Create</button>
            </form>
          </div>
        </div>
      </div>
    );
  };

  const renderDrivePicker = () => {
    if (!drivePicker) return null;
    return (
      <div style={styles.modalOverlay} {...backdropDismiss(() => !uploadState && setDrivePicker(null))}>
        <div style={{ ...styles.modal, maxWidth: '520px' }} onClick={(e) => e.stopPropagation()}>
          <div style={styles.modalHead}>
            <span style={{ fontSize: '15px', fontWeight: 700 }}>
              Upload {drivePicker.assets.length} asset{drivePicker.assets.length === 1 ? '' : 's'} to Drive
            </span>
            <div style={{ flex: 1 }} />
            <button style={styles.modalClose} onClick={() => setDrivePicker(null)}>✕</button>
          </div>

          {uploadState ? (
            <div style={styles.uploadStatus}>
              {uploadState.done < uploadState.total ? (
                <>
                  <div style={styles.uploadBarOuter}>
                    <div style={{ ...styles.uploadBarInner, width: `${(uploadState.done / uploadState.total) * 100}%` }} />
                  </div>
                  <div style={{ fontSize: '13px', color: '#a5b4fc' }}>
                    Uploading {uploadState.done + 1}/{uploadState.total}
                    {uploadState.failed ? ` · ${uploadState.failed} failed` : ''}
                  </div>
                  {uploadState.current && (
                    <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.35)', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {uploadState.current}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: uploadState.failed ? '#fcd34d' : '#4ade80' }}>
                    {uploadState.total - uploadState.failed}/{uploadState.total} uploaded
                    {uploadState.failed ? ` — ${uploadState.failed} failed` : ' ✓'}
                  </div>
                  <button style={styles.primaryBtn} onClick={() => setDrivePicker(null)}>Done</button>
                </>
              )}
            </div>
          ) : (
            <>
              <div style={{ ...styles.crumbBar, padding: '12px 18px 0', marginBottom: 0 }}>
                {drivePath.map((crumb, i) => (
                  <React.Fragment key={crumb.id}>
                    {i > 0 && <span style={styles.crumbSep}>/</span>}
                    <button style={styles.crumb} onClick={() => jumpToDriveCrumb(i)}>{crumb.name}</button>
                  </React.Fragment>
                ))}
              </div>

              <div style={styles.folderList}>
                {driveLoading && <div style={styles.folderEmpty}>Loading…</div>}
                {!driveLoading && driveFolders.length === 0 && <div style={styles.folderEmpty}>No subfolders.</div>}
                {!driveLoading && driveFolders.map((f) => (
                  <button key={f.id} style={styles.folderItem} onClick={() => enterDriveFolder(f)}>
                    📁 {f.name}
                  </button>
                ))}
              </div>

              <div style={styles.newFolderRow}>
                <input
                  style={{ ...styles.input, flex: 1 }}
                  value={newFolderName}
                  placeholder="New folder name…"
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') createDriveFolder(); }}
                />
                <button
                  style={{ ...styles.primaryBtn, flex: 'none' }}
                  onClick={createDriveFolder}
                  disabled={creatingFolder || !newFolderName.trim()}
                >
                  {creatingFolder ? 'Creating…' : 'Create'}
                </button>
              </div>

              {driveError && <div style={{ ...styles.errorMsg, padding: '0 18px', marginBottom: 0 }}>{driveError}</div>}

              <div style={styles.drivePickerFooter}>
                <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.45)' }}>
                  Destination: {drivePath[drivePath.length - 1].name}
                </span>
                <div style={{ flex: 1 }} />
                <button style={styles.primaryBtn} onClick={uploadToDrive}>Upload here</button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  };

  const renderTable = (rows, { fromPlaylist, folders } = {}) => (
    <div style={styles.tableScroll}>
      <table style={styles.table}>
        <thead>
          <tr>
            {!fromPlaylist && <th style={{ ...styles.th, width: '30px' }} />}
            <th style={{ ...styles.th, width: '54px' }} />
            <th style={styles.th}>Name</th>
            <th style={styles.th}>Type</th>
            <th style={styles.th}>Size</th>
            <th style={styles.th}>Modified</th>
            <th style={styles.th}>Path</th>
            <th style={{ ...styles.th, width: '100px' }} />
          </tr>
        </thead>
        <tbody>
          {(folders || []).map((f) => (
            <tr key={f.path} style={styles.tr} onClick={() => openFolder(f.path)}>
              <td style={styles.td} />
              <td style={styles.td}><span style={{ fontSize: '18px' }}>📁</span></td>
              <td style={{ ...styles.td, fontWeight: 600 }} colSpan={5}>{f.name}</td>
              <td style={styles.td} />
            </tr>
          ))}
          {rows.map((asset, i) => (
            <tr
              key={fromPlaylist ? playlistItems[i].id : asset.id}
              style={{ ...styles.tr, ...(selectedIds.has(asset.id) && !fromPlaylist ? styles.trSelected : null) }}
              onClick={() => setModal({ list: rows, index: i })}
            >
              {!fromPlaylist && (
                <td style={styles.td} onClick={(e) => { e.stopPropagation(); toggleSelected(asset.id); }}>
                  <input type="checkbox" readOnly checked={selectedIds.has(asset.id)} style={{ cursor: 'pointer' }} />
                </td>
              )}
              <td style={styles.td}>
                {asset.thumbnail
                  ? <img src={asset.thumbnail} alt="" style={styles.thumb} />
                  : <span style={{ fontSize: '18px' }}>{typeIcon(asset.type)}</span>}
              </td>
              <td style={{ ...styles.td, maxWidth: '340px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{asset.name}</td>
              <td style={styles.td}>{String(asset.type || '').toLowerCase()}</td>
              <td style={styles.td}>{fmtSize(asset.size_bytes)}</td>
              <td style={styles.td}>{fmtDate(asset.updated)}</td>
              <td style={{ ...styles.td, maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', color: 'rgba(255,255,255,0.35)' }}>{asset.path}</td>
              <td style={styles.td} onClick={(e) => e.stopPropagation()}>
                <button style={styles.rowBtn} title="Download" onClick={() => downloadAsset(asset)}>↓</button>
                <button
                  style={{ ...styles.rowBtn, marginLeft: '4px' }}
                  title="Upload to Drive"
                  onClick={() => openDrivePicker([asset])}
                >↑</button>
                {fromPlaylist && (
                  <button
                    style={{ ...styles.rowBtn, color: '#f87171', marginLeft: '4px' }}
                    title="Remove from playlist"
                    onClick={() => removePlaylistItem(playlistItems[i].id)}
                  >✕</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  // ─── Layout: left panel + results column (mirrors the Pitches view) ──────
  if (notConfigured) {
    return (
      <div style={{ ...styles.placeholder, flex: 1 }}>
        <div style={{ fontSize: '32px', marginBottom: '12px' }}>🔌</div>
        Shade isn't connected yet. Add <code>SHADE_API_KEY</code> and <code>SHADE_DRIVE_ID</code> to
        the Supabase edge function secrets, then reload.
      </div>
    );
  }

  return (
    <>
      {/* ── Left: search / playlist panel ── */}
      <div style={styles.filterCol}>
        {renderViewToggle()}

        {view === 'search' && (
          <>
            <div style={styles.filterField}>
              <label style={styles.filterLabel}>Describe what you need</label>
              <textarea
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runSearch(); }
                }}
                rows={3}
                placeholder='"crowd reaction home run night game"'
                style={{ ...styles.input, resize: 'vertical', minHeight: '58px' }}
              />
            </div>
            <div style={styles.filterField}>
              <label style={styles.filterLabel}>Asset types</label>
              <div style={styles.chipRow}>
                <button
                  type="button"
                  style={{ ...styles.chip, ...(types.length === 0 ? styles.chipOn : null) }}
                  onClick={() => setTypes([])}
                >All</button>
                {TYPE_FILTERS.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    style={{ ...styles.chip, ...(types.includes(t.key) ? styles.chipOn : null) }}
                    onClick={() => toggleType(t.key)}
                  >{t.label}</button>
                ))}
              </div>
            </div>
            <button style={styles.primaryBtn} disabled={searching} onClick={() => runSearch()}>
              {searching ? 'Searching…' : 'Search'}
            </button>
            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', lineHeight: 1.5 }}>
              The AI index matches on visual content, transcripts, and metadata — not just filenames.
              {browsePath !== '/' && (
                <> Searching inside <span style={{ color: '#a5b4fc' }}>📁 {crumbs[crumbs.length - 1].name}</span> (subfolders included).</>
              )}
            </div>
          </>
        )}

        {view === 'playlist' && (
          <div style={styles.filterField}>
            <label style={styles.filterLabel}>Playlist</label>
            <select
              style={styles.input}
              value={activePlaylistId || ''}
              onChange={(e) => setActivePlaylistId(e.target.value || null)}
            >
              <option value="">Select a playlist…</option>
              {playlists.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.asset_playlist_items?.[0]?.count ?? 0})
                </option>
              ))}
            </select>
            {activePlaylist && (
              <div style={{ display: 'flex', gap: '6px' }}>
                <button style={styles.plMgmtBtn} onClick={() => renamePlaylist(activePlaylist.id)}>Rename</button>
                <button style={{ ...styles.plMgmtBtn, color: '#fca5a5' }} onClick={() => deletePlaylist(activePlaylist.id)}>Delete</button>
              </div>
            )}
          </div>
        )}

        {batch && (
          <span style={styles.batchProgress}>
            {batch.total > 1 ? `Bundling ${batch.done}/${batch.total}…` : 'Downloading…'}
            {batch.failed > 0 ? ` (${batch.failed} failed)` : ''}
            {batch.total > 1 && (
              <button
                style={{ ...styles.rowBtn, width: 'auto', padding: '0 8px', marginLeft: '8px' }}
                onClick={() => { batchCancelRef.current = true; }}
              >Cancel</button>
            )}
          </span>
        )}
      </div>

      {/* ── Right: results / playlist queue ── */}
      <div style={styles.resultsCol}>
        {view === 'search' && (
          <>
            {searchError && <div style={styles.errorMsg}>{searchError}</div>}
            {driveHelp && (
              <div style={styles.driveHelp}>
                {driveHelp.length > 0 ? (
                  <>
                    <div style={{ fontWeight: 700, marginBottom: '6px' }}>
                      SHADE_DRIVE_ID doesn't match a drive this API key can see. Drives available to the key:
                    </div>
                    {driveHelp.map((d) => (
                      <div key={d.id} style={{ marginBottom: '2px' }}>
                        {d.name} — <code style={{ userSelect: 'all' }}>{d.id}</code>
                      </div>
                    ))}
                    <div style={{ marginTop: '6px', color: 'rgba(255,255,255,0.45)' }}>
                      Update the secret and re-run: <code>supabase secrets set SHADE_DRIVE_ID=…</code>
                    </div>
                  </>
                ) : (
                  <>SHADE_DRIVE_ID doesn't match a drive this API key can see, and the key can't list drives.
                  Grab the drive UUID from the Shade web app URL and update the secret.</>
                )}
              </div>
            )}

            {selectedIds.size > 0 && (
              <div style={styles.selectionBar}>
                <span style={{ fontSize: '13px', color: '#a5b4fc' }}>{selectedIds.size} selected</span>
                <button style={styles.batchBtn} onClick={() => setAddPicker({ assets: selectedAssets })}>+ Playlist</button>
                <button style={styles.batchBtn} onClick={() => runBatchDownload(selectedAssets)} disabled={!!batch}>
                  Download{selectedIds.size > 1 ? ' (.zip)' : ''}
                </button>
                <button style={styles.batchBtn} onClick={() => openDrivePicker(selectedAssets)}>Upload to Drive</button>
                <button style={{ ...styles.chip, marginLeft: '2px' }} onClick={() => setSelectedIds(new Set())}>Clear</button>
              </div>
            )}

            <div style={styles.crumbBar}>
              {crumbs.map((c, i) => (
                <React.Fragment key={c.path}>
                  {i > 0 && <span style={styles.crumbSep}>›</span>}
                  <button
                    style={{
                      ...styles.crumb,
                      ...(i === crumbs.length - 1 && assets === null ? styles.crumbOn : null),
                    }}
                    onClick={() => openFolder(c.path)}
                  >{i === 0 ? c.name : `📁 ${c.name}`}</button>
                </React.Fragment>
              ))}
              {assets !== null && <span style={styles.crumbSep}>› search results</span>}
            </div>

            {/* Browsing (no search results active) */}
            {assets === null && browseLoading && (
              <div style={styles.placeholder}>Loading folder…</div>
            )}
            {assets === null && !browseLoading && browse && (
              browse.folders.length === 0 && browseAssets.length === 0 ? (
                !searchError && <div style={styles.placeholder}>This folder is empty.</div>
              ) : (
                <>
                  <div style={styles.resultsBar}>
                    <span style={styles.resultsCount}>
                      {browse.folders.length > 0 && `${browse.folders.length} folder${browse.folders.length === 1 ? '' : 's'}`}
                      {browse.folders.length > 0 && browseAssets.length > 0 && ' · '}
                      {browseAssets.length > 0 && `${browseAssets.length} file${browseAssets.length === 1 ? '' : 's'}`}
                    </span>
                    {browseAssets.length > 0 && (
                      <button
                        style={styles.chip}
                        onClick={() => setSelectedIds(new Set(browseAssets.map((a) => a.id)))}
                      >Select all</button>
                    )}
                  </div>
                  {renderTable(browseAssets, { folders: browse.folders })}
                </>
              )
            )}

            {/* Search results */}
            {assets !== null && assets.length === 0 && !searching && !searchError && (
              <div style={styles.placeholder}>No assets matched. Try broader wording or fewer type filters.</div>
            )}
            {assets !== null && assets.length > 0 && (
              <>
                <div style={styles.resultsBar}>
                  <span style={styles.resultsCount}>
                    {assets.length} result{assets.length === 1 ? '' : 's'}
                    {browsePath !== '/' ? ` in ${crumbs[crumbs.length - 1].name}` : ''}
                  </span>
                  <button
                    style={styles.chip}
                    onClick={() => setSelectedIds(new Set(assets.map((a) => a.id)))}
                  >Select all</button>
                  <button
                    style={styles.chip}
                    onClick={() => { setAssets(null); setQuery(''); }}
                  >✕ Clear search</button>
                </div>
                {renderTable(assets)}
              </>
            )}
          </>
        )}

        {view === 'playlist' && (
          <>
            {!activePlaylistId && (
              <div style={styles.placeholder}>
                Pick a playlist, or select assets in Search and hit “+ Playlist”.
              </div>
            )}
            {activePlaylistId && playlistLoading && <div style={styles.placeholder}>Loading…</div>}
            {activePlaylistId && !playlistLoading && playlistItems.length === 0 && (
              <div style={styles.placeholder}>This playlist is empty — add assets from the Search view.</div>
            )}
            {activePlaylistId && !playlistLoading && playlistItems.length > 0 && (
              <>
                <div style={styles.resultsBar}>
                  <span style={styles.resultsCount}>{playlistItems.length} asset{playlistItems.length === 1 ? '' : 's'}</span>
                  <button style={styles.batchBtn} onClick={() => setModal({ list: playlistAssets, index: 0 })}>▶ Review all</button>
                  <button style={styles.batchBtn} onClick={() => runBatchDownload(playlistAssets)} disabled={!!batch}>
                    Download all{playlistItems.length > 1 ? ' (.zip)' : ''}
                  </button>
                  <button style={styles.batchBtn} onClick={() => openDrivePicker(playlistAssets)}>Upload all to Drive</button>
                </div>
                {renderTable(playlistAssets, { fromPlaylist: true })}
              </>
            )}
          </>
        )}
      </div>

      {renderModal()}
      {renderAddPicker()}
      {renderDrivePicker()}
    </>
  );
}

const styles = {
  filterCol: {
    width: '260px',
    flexShrink: 0,
    padding: '18px',
    borderRight: '1px solid rgba(255,255,255,0.06)',
    overflowY: 'auto',
    maxHeight: 'calc(100vh - 75px)',
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
  },
  filterField: { display: 'flex', flexDirection: 'column', gap: '5px' },
  filterLabel: {
    fontSize: '11px',
    fontWeight: 600,
    letterSpacing: '0.4px',
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.4)',
  },
  viewTabs: {
    display: 'flex',
    gap: '4px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '8px',
    padding: '3px',
    boxSizing: 'border-box',
  },
  viewTab: {
    flex: 1,
    background: 'none',
    border: 'none',
    borderRadius: '6px',
    color: 'rgba(255,255,255,0.55)',
    padding: '5px 14px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  viewTabOn: {
    background: 'rgba(99,102,241,0.18)',
    color: '#a5b4fc',
  },
  input: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '8px',
    color: '#e2e8f0',
    padding: '7px 10px',
    fontSize: '13px',
    fontFamily: 'inherit',
    width: '100%',
    boxSizing: 'border-box',
    colorScheme: 'dark',
    outline: 'none',
  },
  primaryBtn: {
    background: '#6366f1',
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    padding: '8px 22px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  plMgmtBtn: {
    flex: 1,
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '8px',
    color: 'rgba(255,255,255,0.6)',
    padding: '6px 0',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  chipRow: { display: 'flex', flexWrap: 'wrap', gap: '5px' },
  chip: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '999px',
    color: 'rgba(255,255,255,0.55)',
    padding: '3px 10px',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  chipOn: {
    background: 'rgba(99,102,241,0.18)',
    borderColor: 'rgba(99,102,241,0.5)',
    color: '#a5b4fc',
  },
  selectionBar: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' },
  batchBtn: {
    background: 'rgba(99,102,241,0.15)',
    border: '1px solid rgba(99,102,241,0.4)',
    borderRadius: '8px',
    color: '#a5b4fc',
    padding: '7px 14px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  batchProgress: { fontSize: '13px', color: '#a5b4fc', display: 'flex', alignItems: 'center', flexWrap: 'wrap' },
  errorMsg: { color: '#f87171', fontSize: '13px', marginBottom: '10px' },
  driveHelp: {
    background: 'rgba(245,158,11,0.08)',
    border: '1px solid rgba(245,158,11,0.3)',
    borderRadius: '10px',
    padding: '12px 14px',
    fontSize: '13px',
    color: '#fcd34d',
    marginBottom: '12px',
    lineHeight: 1.5,
  },
  resultsCol: {
    flex: 1,
    minWidth: 0,
    padding: '18px 24px',
    display: 'flex',
    flexDirection: 'column',
  },
  resultsBar: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' },
  crumbBar: { display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap', marginBottom: '10px' },
  crumb: {
    background: 'none',
    border: 'none',
    borderRadius: '6px',
    color: 'rgba(255,255,255,0.55)',
    padding: '4px 8px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  crumbOn: { color: '#e2e8f0', background: 'rgba(255,255,255,0.05)' },
  crumbSep: { color: 'rgba(255,255,255,0.25)', fontSize: '13px' },
  resultsCount: { fontSize: '13px', color: 'rgba(255,255,255,0.45)' },
  placeholder: {
    padding: '80px 20px',
    textAlign: 'center',
    color: 'rgba(255,255,255,0.3)',
    fontSize: '14px',
    lineHeight: 1.6,
  },
  tableScroll: {
    overflow: 'auto',
    flex: 1,
    minHeight: 0,
    maxHeight: 'calc(100vh - 175px)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '12px',
  },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '13px' },
  th: {
    position: 'sticky',
    top: 0,
    background: '#16162a',
    textAlign: 'left',
    padding: '9px 12px',
    fontSize: '11px',
    fontWeight: 600,
    letterSpacing: '0.4px',
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.4)',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    zIndex: 1,
  },
  tr: { cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.04)' },
  trSelected: { background: 'rgba(99,102,241,0.12)' },
  td: { padding: '8px 12px', whiteSpace: 'nowrap' },
  thumb: { width: '44px', height: '28px', objectFit: 'cover', borderRadius: '4px', display: 'block' },
  rowBtn: {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '6px',
    color: '#a5b4fc',
    width: '26px',
    height: '26px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 2000,
    background: 'rgba(0,0,0,0.75)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
  },
  modal: {
    background: '#12121f',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '14px',
    width: '100%',
    maxWidth: '900px',
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  modalHead: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '14px 18px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    minWidth: 0,
  },
  modalBody: {
    flex: 1,
    minHeight: '320px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#000',
  },
  modalMedia: { maxWidth: '100%', maxHeight: '62vh', display: 'block' },
  modalMsg: { color: 'rgba(255,255,255,0.4)', fontSize: '14px', textAlign: 'center', padding: '40px' },
  modalNav: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '10px',
    padding: '12px 18px',
    borderTop: '1px solid rgba(255,255,255,0.06)',
    minWidth: 0,
  },
  modalBtn: {
    background: 'rgba(99,102,241,0.15)',
    border: '1px solid rgba(99,102,241,0.4)',
    borderRadius: '8px',
    color: '#a5b4fc',
    padding: '7px 14px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  modalClose: {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '8px',
    color: 'rgba(255,255,255,0.6)',
    width: '30px',
    height: '30px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  folderList: {
    margin: '10px 18px 0',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '10px',
    minHeight: '160px',
    maxHeight: '260px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    padding: '6px',
  },
  folderItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    background: 'none',
    border: 'none',
    borderRadius: '8px',
    color: '#e2e8f0',
    padding: '8px 10px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'left',
  },
  folderEmpty: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: '13px',
    textAlign: 'center',
    padding: '30px 10px',
  },
  newFolderRow: { display: 'flex', gap: '6px', padding: '10px 18px 0' },
  drivePickerFooter: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '14px 18px',
    marginTop: '12px',
    borderTop: '1px solid rgba(255,255,255,0.06)',
  },
  uploadStatus: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '10px',
    padding: '34px 24px',
  },
  uploadBarOuter: {
    width: '100%',
    height: '8px',
    background: 'rgba(255,255,255,0.06)',
    borderRadius: '999px',
    overflow: 'hidden',
  },
  uploadBarInner: {
    height: '100%',
    background: '#6366f1',
    borderRadius: '999px',
    transition: 'width 0.3s',
  },
  pickerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '10px',
    padding: '9px 12px',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '10px',
    color: '#e2e8f0',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'left',
  },
};
