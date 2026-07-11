import React, { useState, useEffect, useRef, useCallback } from 'react';
import { zipSync } from 'fflate';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import PlayerSearchField from './graphics/PlayerSearchField';
import ShadeAssets from './ShadeAssets';

// Asset Search — two sections behind header tabs: Pitches (this file's
// search below) and Assets (ShadeAssets.js, AI search over the Shade drive).
//
// Pitches — search the Savant clip archive (Triton pitch_videos
// index + Mayday Cloud NAS), review clips in a modal, and download them
// locally or upload to the shared Pitch Videos folder on Google Drive.
//
// Layout: left filter column · results table · right History drawer
// (collapsed by default). History is global — every executed search is
// logged to pitch_video_searches with the user's name, and clicking an
// entry re-fills the filter panel so the search can be re-run or adjusted.
//
// Search goes through the same-origin /api/pitch-video proxy (Mayday JWT +
// server-side Triton consumer key). Drive uploads reuse the platform's
// resumable-upload pattern: pitch-video-drive lists/creates folders under
// the shared root; drive-upload-init opens the session; the browser PUTs
// clip bytes straight to Drive.

const PITCH_TYPES = [
  ['FF', 'Four-Seam'], ['SI', 'Sinker'], ['FC', 'Cutter'],
  ['SL', 'Slider'], ['ST', 'Sweeper'], ['SV', 'Slurve'],
  ['CU', 'Curveball'], ['KC', 'Knuckle Curve'], ['CH', 'Changeup'],
  ['FS', 'Splitter'], ['KN', 'Knuckleball'], ['EP', 'Eephus'],
];

const EVENTS = [
  'home_run', 'strikeout', 'single', 'double', 'triple', 'walk',
  'field_out', 'force_out', 'grounded_into_double_play', 'sac_fly',
  'hit_by_pitch', 'field_error',
];

const DESCRIPTIONS = [
  'swinging_strike', 'swinging_strike_blocked', 'called_strike',
  'foul', 'foul_tip', 'ball', 'blocked_ball', 'hit_into_play', 'missed_bunt',
];

const EMPTY_FILTERS = {
  pitcher: { playerId: null, playerName: '' },
  batter: { playerId: null, playerName: '' },
  team: '',
  pitchTypes: [],
  event: '',
  description: '',
  dateFrom: '',
  dateTo: '',
  gameYear: '',
  veloMin: '',
  veloMax: '',
  stand: '',
  pThrows: '',
  balls: '',
  strikes: '',
  inning: '',
  onlyArchived: false,
};

const DRIVE_FN_URL = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/pitch-video-drive`;
const UPLOAD_INIT_URL = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/drive-upload-init`;
const DRIVE_ROOT = { id: '1evC6T-cSra_KF89QzQ0KhDeXR5a4a2g1', name: 'Pitch Videos' };

function label(s) {
  return String(s || '').replace(/_/g, ' ');
}

function titleCase(s) {
  return label(s).replace(/\b\w/g, (c) => c.toUpperCase());
}

// "Palmquist, Carson" → "Carson Palmquist"
function flipName(name) {
  const parts = String(name || '').split(',');
  if (parts.length === 2) return `${parts[1].trim()} ${parts[0].trim()}`;
  return String(name || '').trim();
}

function outcome(row) {
  return titleCase(row.events || row.description || 'Unknown');
}

// [Pitcher] to [Hitter] [Pitch Type] [Count] [Outcome].mp4
function clipFilename(row) {
  const raw = `${flipName(row.player_name)} to ${flipName(row.batter_name)} ${row.pitch_type || 'NA'} ${row.balls ?? '-'}-${row.strikes ?? '-'} ${outcome(row)}`;
  return `${raw.replace(/[^\w\-. ]+/g, '').replace(/\s+/g, ' ').trim()}.mp4`;
}

function rowKey(row) {
  return `${row.game_pk}-${row.at_bat_number}-${row.pitch_number}`;
}

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// Compact human summary of a filter set for the History drawer.
function summarizeFilters(f) {
  const bits = [];
  if (f.pitcher?.playerName) bits.push(f.pitcher.playerName);
  if (f.batter?.playerName) bits.push(`vs ${f.batter.playerName}`);
  if (f.team) bits.push(f.team);
  if (f.pitchTypes?.length) bits.push(f.pitchTypes.join('/'));
  if (f.event) bits.push(label(f.event));
  if (f.description) bits.push(label(f.description));
  if (f.gameYear) bits.push(f.gameYear);
  if (f.dateFrom || f.dateTo) bits.push(`${f.dateFrom || '…'}→${f.dateTo || '…'}`);
  if (f.veloMin || f.veloMax) bits.push(`${f.veloMin || '…'}–${f.veloMax || '…'} mph`);
  if (f.balls !== '' && f.balls != null) bits.push(`${f.balls}-${f.strikes !== '' && f.strikes != null ? f.strikes : 'x'}`);
  else if (f.strikes !== '' && f.strikes != null) bits.push(`x-${f.strikes}`);
  if (f.stand) bits.push(`bat ${f.stand}`);
  if (f.pThrows) bits.push(`thr ${f.pThrows}`);
  if (f.inning) bits.push(`inn ${f.inning}`);
  return bits.length ? bits.join(' · ') : 'all pitches';
}

export default function PitchVideos({ onBack }) {
  const { profile } = useAuth();

  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [rows, setRows] = useState(null); // null = not searched yet
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);

  // Row selection for batch actions
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());

  // Review modal: { clips: [row...], index } — single view is a 1-clip playlist
  const [modal, setModal] = useState(null);

  // Live-resolved CDN mp4s for not-yet-archived clips, keyed by rowKey.
  // undefined = not tried, null = resolving failed, string = playable URL.
  const [savantMp4, setSavantMp4] = useState({});
  const [resolvingKey, setResolvingKey] = useState(null);

  // Global history drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [history, setHistory] = useState([]);

  // Drive upload flow
  const [drivePicker, setDrivePicker] = useState(null); // { rows: [row...] }
  const [driveFolders, setDriveFolders] = useState([]);
  const [drivePath, setDrivePath] = useState([DRIVE_ROOT]); // breadcrumb
  const [driveLoading, setDriveLoading] = useState(false);
  const [driveError, setDriveError] = useState(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [uploadState, setUploadState] = useState(null); // { done, total, failed, current }

  // Local batch download progress
  const [batch, setBatch] = useState(null);

  // Top-level section: Pitches (Savant clip archive, everything below) or
  // Assets (Shade drive AI search — self-contained in ShadeAssets).
  const [section, setSection] = useState('pitches'); // 'pitches' | 'assets'

  // Playlist view — DB-backed personal playlists (pitch_playlists +
  // pitch_playlist_items, RLS owner-only). Items snapshot the pitch row as
  // jsonb so playback works without re-querying Triton.
  const [view, setView] = useState('search'); // 'search' | 'playlist'
  const [playlists, setPlaylists] = useState([]);
  const [activePlaylistId, setActivePlaylistId] = useState(null);
  const [playlistItems, setPlaylistItems] = useState([]);
  const [playlistLoading, setPlaylistLoading] = useState(false);
  const [playIndex, setPlayIndex] = useState(0);
  const [autoAdvance, setAutoAdvance] = useState(false);
  const [addPicker, setAddPicker] = useState(null); // { rows } → playlist picker modal
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const batchCancelRef = useRef(false);

  const setF = (patch) => setFilters((f) => ({ ...f, ...patch }));

  // ─── History: load + realtime ────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('pitch_video_searches')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (!cancelled && data) setHistory(data);
    })();

    const channel = supabase
      .channel('pitch_video_searches_feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pitch_video_searches' }, (payload) => {
        setHistory((h) => [payload.new, ...h].slice(0, 50));
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  const logSearch = useCallback(async (f, resultCount) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      // Skip exact-duplicate back-to-back runs by the same user.
      const latestOwn = history.find((h) => h.user_id === user.id);
      if (latestOwn && JSON.stringify(latestOwn.filters) === JSON.stringify(f)) return;
      await supabase.from('pitch_video_searches').insert({
        user_id: user.id,
        user_name: profile?.full_name || user.email,
        filters: f,
        result_count: resultCount,
      });
    } catch { /* history is best-effort */ }
  }, [history, profile]);

  const applyHistoryEntry = (entry) => {
    setFilters({ ...EMPTY_FILTERS, ...(entry.filters || {}) });
  };

  // ─── Search ───────────────────────────────────────────────────────────────
  const buildQuery = useCallback(() => {
    const q = new URLSearchParams();
    const f = filters;
    if (f.pitcher.playerId) q.set('pitcher', f.pitcher.playerId);
    if (f.batter.playerId) q.set('batter', f.batter.playerId);
    if (f.team.trim()) q.set('team', f.team.trim().toUpperCase());
    if (f.pitchTypes.length) q.set('pitch_type', f.pitchTypes.join(','));
    if (f.event) q.set('event', f.event);
    if (f.description) q.set('description', f.description);
    if (f.dateFrom) q.set('date_from', f.dateFrom);
    if (f.dateTo) q.set('date_to', f.dateTo);
    if (f.gameYear) q.set('game_year', f.gameYear);
    if (f.veloMin) q.set('velo_min', f.veloMin);
    if (f.veloMax) q.set('velo_max', f.veloMax);
    if (f.stand) q.set('stand', f.stand);
    if (f.pThrows) q.set('p_throws', f.pThrows);
    if (f.balls !== '') q.set('balls', f.balls);
    if (f.strikes !== '') q.set('strikes', f.strikes);
    if (f.inning !== '') q.set('inning', f.inning);
    if (f.onlyArchived) q.set('only_archived', 'true');
    q.set('limit', '200');
    return q;
  }, [filters]);

  const runSearch = async () => {
    const q = buildQuery();
    const meaningful = [...q.keys()].filter((k) => !['limit', 'offset'].includes(k));
    if (meaningful.length === 0) {
      setSearchError('Set at least one filter first.');
      return;
    }
    setSearching(true);
    setSearchError(null);
    setSelectedKeys(new Set());
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const res = await fetch(`/api/pitch-video?${q.toString()}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Search failed (${res.status})`);
      const result = json.rows || [];
      setRows(result);
      logSearch(filters, result.length);
    } catch (err) {
      setSearchError(err.message || 'Search failed');
      setRows(null);
    } finally {
      setSearching(false);
    }
  };

  // ─── Selection ────────────────────────────────────────────────────────────
  // Any pitch can be selected (playlists + downloads resolve Savant mp4s on
  // demand); Drive upload still needs the archived NAS copy, so it filters
  // to selectedRows.
  const archivedRows = (rows || []).filter((r) => r.video_url);
  const selectedAnyRows = (rows || []).filter((r) => selectedKeys.has(rowKey(r)));
  const selectedRows = selectedAnyRows.filter((r) => r.video_url);
  const allSelected = (rows || []).length > 0 && selectedAnyRows.length === rows.length;

  const toggleKey = (key) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedKeys(allSelected ? new Set() : new Set((rows || []).map(rowKey)));
  };

  // ─── Playlists ────────────────────────────────────────────────────────────
  const fetchPlaylists = useCallback(async () => {
    const { data, error } = await supabase
      .from('pitch_playlists')
      .select('*, pitch_playlist_items(count)')
      .order('created_at', { ascending: true });
    if (error) { console.error('Error fetching playlists:', error); return; }
    setPlaylists(data || []);
  }, []);

  useEffect(() => { fetchPlaylists(); }, [fetchPlaylists]);

  const fetchPlaylistItems = useCallback(async (playlistId) => {
    if (!playlistId) { setPlaylistItems([]); return; }
    setPlaylistLoading(true);
    const { data, error } = await supabase
      .from('pitch_playlist_items')
      .select('*')
      .eq('playlist_id', playlistId)
      .order('position', { ascending: true });
    if (error) console.error('Error fetching playlist items:', error);
    setPlaylistItems(data || []);
    setPlaylistLoading(false);
  }, []);

  useEffect(() => {
    fetchPlaylistItems(activePlaylistId);
    setPlayIndex(0);
  }, [activePlaylistId, fetchPlaylistItems]);

  // Keep the playing index inside the queue when items are removed
  useEffect(() => {
    setPlayIndex((i) => Math.min(i, Math.max(0, playlistItems.length - 1)));
  }, [playlistItems.length]);

  const createPlaylist = async (name) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return null;
    const { data, error } = await supabase
      .from('pitch_playlists')
      .insert({ name: trimmed, created_by: profile.id })
      .select()
      .single();
    if (error) { console.error('Error creating playlist:', error); return null; }
    await fetchPlaylists();
    return data;
  };

  const addRowsToPlaylist = async (playlistId, rowsToAdd) => {
    setAddBusy(true);
    try {
      const { data: existing } = await supabase
        .from('pitch_playlist_items')
        .select('row_key, position')
        .eq('playlist_id', playlistId);
      const seen = new Set((existing || []).map((r) => r.row_key));
      let pos = (existing || []).reduce((m, r) => Math.max(m, r.position), -1) + 1;
      const payload = rowsToAdd
        .filter((r) => !seen.has(rowKey(r)))
        .map((r) => ({ playlist_id: playlistId, row_key: rowKey(r), clip: r, position: pos++ }));
      if (payload.length) {
        const { error } = await supabase.from('pitch_playlist_items').insert(payload);
        if (error) throw error;
      }
      setAddPicker(null);
      setSelectedKeys(new Set());
      fetchPlaylists();
      if (playlistId === activePlaylistId) fetchPlaylistItems(playlistId);
    } catch (err) {
      console.error('Error adding to playlist:', err);
      alert('Could not add clips to the playlist.');
    } finally {
      setAddBusy(false);
    }
  };

  const deletePlaylist = async (playlistId) => {
    const pl = playlists.find((p) => p.id === playlistId);
    if (!window.confirm(`Delete playlist "${pl?.name || ''}" and its queue?`)) return;
    await supabase.from('pitch_playlists').delete().eq('id', playlistId);
    if (activePlaylistId === playlistId) setActivePlaylistId(null);
    fetchPlaylists();
  };

  const renamePlaylist = async (playlistId) => {
    const pl = playlists.find((p) => p.id === playlistId);
    const name = window.prompt('Rename playlist', pl?.name || '');
    if (!name || !name.trim()) return;
    await supabase.from('pitch_playlists')
      .update({ name: name.trim(), updated_at: new Date().toISOString() })
      .eq('id', playlistId);
    fetchPlaylists();
  };

  const removePlaylistItem = async (itemId) => {
    const idx = playlistItems.findIndex((it) => it.id === itemId);
    setPlaylistItems((prev) => prev.filter((it) => it.id !== itemId));
    if (idx !== -1 && idx < playIndex) setPlayIndex((i) => Math.max(0, i - 1));
    await supabase.from('pitch_playlist_items').delete().eq('id', itemId);
    fetchPlaylists();
  };

  const movePlaylistItem = async (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= playlistItems.length) return;
    const a = playlistItems[idx];
    const b = playlistItems[j];
    const next = [...playlistItems];
    next[idx] = { ...b, position: a.position };
    next[j] = { ...a, position: b.position };
    setPlaylistItems(next);
    if (playIndex === idx) setPlayIndex(j);
    else if (playIndex === j) setPlayIndex(idx);
    await Promise.all([
      supabase.from('pitch_playlist_items').update({ position: b.position }).eq('id', a.id),
      supabase.from('pitch_playlist_items').update({ position: a.position }).eq('id', b.id),
    ]);
  };

  // ─── Local download ───────────────────────────────────────────────────────
  // Archived clips stream from the Mayday NAS; unarchived ones resolve the
  // Savant CDN mp4 on demand (MLB's CDN allows cross-origin fetches), so any
  // pitch with a clip is downloadable with the formatted filename.
  const getPlayableUrl = async (row) => {
    if (row.video_url) return row.video_url;
    const key = rowKey(row);
    if (savantMp4[key] !== undefined) return savantMp4[key];
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `/api/pitch-video?game_pk=${row.game_pk}&ab=${row.at_bat_number}&pitch=${row.pitch_number}&resolve_mp4=true`,
        { headers: { Authorization: `Bearer ${session.access_token}` } },
      );
      const json = await res.json().catch(() => ({}));
      const url = json?.row?.savant_mp4_url || null;
      setSavantMp4((m) => ({ ...m, [key]: url }));
      return url;
    } catch {
      return null;
    }
  };

  const downloadClip = async (row) => {
    const src = await getPlayableUrl(row);
    if (!src) {
      if (row.savant_url) window.open(row.savant_url, '_blank', 'noopener');
      return false;
    }
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = clipFilename(row);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      return true;
    } catch {
      window.open(src, '_blank', 'noopener');
      return false;
    }
  };

  const fetchClipBytes = async (row) => {
    const src = await getPlayableUrl(row);
    if (!src) return null;
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    } catch {
      return null;
    }
  };

  // Browsers block every programmatic download after the first one in a
  // batch (no user activation), so multi-clip downloads are bundled into a
  // single zip. Store mode — the mp4s don't recompress.
  const runBatchDownload = async (targets) => {
    if (!targets.length) return;
    if (targets.length === 1) {
      setBatch({ done: 0, total: 1, failed: 0 });
      await downloadClip(targets[0]);
      setBatch(null);
      return;
    }
    batchCancelRef.current = false;
    setBatch({ done: 0, total: targets.length, failed: 0 });
    const files = {};
    for (let i = 0; i < targets.length; i++) {
      if (batchCancelRef.current) { setBatch(null); return; }
      const bytes = await fetchClipBytes(targets[i]);
      if (bytes) {
        let name = clipFilename(targets[i]);
        if (files[name]) {
          const base = name.replace(/\.mp4$/, '');
          let n = 2;
          while (files[`${base} (${n}).mp4`]) n++;
          name = `${base} (${n}).mp4`;
        }
        files[name] = [bytes, { level: 0 }];
      }
      setBatch((b) => b && ({ ...b, done: i + 1, failed: b.failed + (bytes ? 0 : 1) }));
    }
    if (Object.keys(files).length > 0) {
      const blob = new Blob([zipSync(files)], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pitch-clips-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
    setBatch(null);
  };

  // ─── Drive upload ─────────────────────────────────────────────────────────
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
    setDrivePicker({ rows: targets });
    setDrivePath([DRIVE_ROOT]);
    setNewFolderName('');
    setUploadState(null);
    loadDriveFolders(DRIVE_ROOT.id);
  };

  const enterFolder = (folder) => {
    setDrivePath((p) => [...p, folder]);
    loadDriveFolders(folder.id);
  };

  const jumpToCrumb = (idx) => {
    const next = drivePath.slice(0, idx + 1);
    setDrivePath(next);
    loadDriveFolders(next[next.length - 1].id);
  };

  const createFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    setCreatingFolder(true);
    setDriveError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const parentId = drivePath[drivePath.length - 1].id;
      const res = await fetch(DRIVE_FN_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ parentId, name }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Create failed (${res.status})`);
      setNewFolderName('');
      enterFolder(json.folder);
    } catch (err) {
      setDriveError(err.message || 'Failed to create folder');
    } finally {
      setCreatingFolder(false);
    }
  };

  const uploadToDrive = async () => {
    if (!drivePicker) return;
    const targets = drivePicker.rows;
    const parentFolderId = drivePath[drivePath.length - 1].id;
    const { data: { session } } = await supabase.auth.getSession();
    setUploadState({ done: 0, total: targets.length, failed: 0, current: '' });

    for (let i = 0; i < targets.length; i++) {
      const row = targets[i];
      const filename = clipFilename(row);
      setUploadState((u) => u && ({ ...u, current: filename }));
      try {
        const clipRes = await fetch(row.video_url);
        if (!clipRes.ok) throw new Error(`clip fetch ${clipRes.status}`);
        const blob = await clipRes.blob();

        const initRes = await fetch(UPLOAD_INIT_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ filename, parentFolderId, mimeType: 'video/mp4', sizeBytes: blob.size }),
        });
        const initJson = await initRes.json().catch(() => ({}));
        if (!initRes.ok || !initJson.uploadUrl) {
          throw new Error(initJson.error || `Upload init failed (${initRes.status})`);
        }

        const putRes = await fetch(initJson.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'video/mp4' },
          body: blob,
        });
        if (!putRes.ok) throw new Error(`Drive PUT ${putRes.status}`);
        setUploadState((u) => u && ({ ...u, done: i + 1 }));
      } catch (err) {
        setUploadState((u) => u && ({ ...u, done: i + 1, failed: u.failed + 1 }));
      }
    }
    setUploadState((u) => u && ({ ...u, current: '' }));
  };

  // ─── Modal player ─────────────────────────────────────────────────────────
  const openSingle = (row) => setModal({ clips: [row], index: 0 });
  const openPlaylist = () => {
    if (selectedAnyRows.length) setModal({ clips: selectedAnyRows, index: 0 });
  };
  const modalClip = modal ? modal.clips[modal.index] : null;
  const modalNext = () => setModal((m) => m && ({ ...m, index: Math.min(m.index + 1, m.clips.length - 1) }));
  const modalPrev = () => setModal((m) => m && ({ ...m, index: Math.max(m.index - 1, 0) }));

  useEffect(() => {
    if (!modal) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setModal(null);
      if (e.key === 'ArrowRight') modalNext();
      if (e.key === 'ArrowLeft') modalPrev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal]);

  // When a not-yet-archived clip is opened, ask Triton to live-resolve the
  // Savant CDN mp4 so it can play in the modal instead of linking out.
  useEffect(() => {
    const clip = modal ? modal.clips[modal.index] : null;
    if (!clip || clip.video_url) return undefined;
    const key = rowKey(clip);
    if (savantMp4[key] !== undefined) return undefined;
    let cancelled = false;
    (async () => {
      setResolvingKey(key);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(
          `/api/pitch-video?game_pk=${clip.game_pk}&ab=${clip.at_bat_number}&pitch=${clip.pitch_number}&resolve_mp4=true`,
          { headers: { Authorization: `Bearer ${session.access_token}` } },
        );
        const json = await res.json().catch(() => ({}));
        if (!cancelled) {
          setSavantMp4((m) => ({ ...m, [key]: json?.row?.savant_mp4_url || null }));
        }
      } catch {
        if (!cancelled) setSavantMp4((m) => ({ ...m, [key]: null }));
      } finally {
        if (!cancelled) setResolvingKey((k) => (k === key ? null : k));
      }
    })();
    return () => { cancelled = true; };
  }, [modal, savantMp4]);

  // ─── Playlist view ────────────────────────────────────────────────────────
  const activePlaylist = playlists.find((p) => p.id === activePlaylistId) || null;
  const playClip = playlistItems[playIndex]?.clip || null;
  const playClipKey = playClip ? rowKey(playClip) : null;
  const playSrc = playClip ? (playClip.video_url || savantMp4[playClipKey]) : null;

  // Unarchived playlist clips: live-resolve the Savant CDN mp4 when they come
  // up for playback (same path as the review modal).
  useEffect(() => {
    if (view !== 'playlist' || !playClip || playClip.video_url) return undefined;
    const key = rowKey(playClip);
    if (savantMp4[key] !== undefined) return undefined;
    let cancelled = false;
    (async () => {
      setResolvingKey(key);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(
          `/api/pitch-video?game_pk=${playClip.game_pk}&ab=${playClip.at_bat_number}&pitch=${playClip.pitch_number}&resolve_mp4=true`,
          { headers: { Authorization: `Bearer ${session.access_token}` } },
        );
        const json = await res.json().catch(() => ({}));
        if (!cancelled) setSavantMp4((m) => ({ ...m, [key]: json?.row?.savant_mp4_url || null }));
      } catch {
        if (!cancelled) setSavantMp4((m) => ({ ...m, [key]: null }));
      } finally {
        if (!cancelled) setResolvingKey((k) => (k === key ? null : k));
      }
    })();
    return () => { cancelled = true; };
  }, [view, playClip, savantMp4]);

  // Search ↔ Playlist toggle pinned to the top of the left panel in both views.
  function renderViewToggle() {
    return (
      <div style={{ ...styles.viewTabs, marginLeft: 0, width: '100%', boxSizing: 'border-box' }}>
        <button
          style={{ ...styles.viewTab, flex: 1, ...(view === 'search' ? styles.viewTabOn : null) }}
          onClick={() => setView('search')}
        >
          Search
        </button>
        <button
          style={{ ...styles.viewTab, flex: 1, ...(view === 'playlist' ? styles.viewTabOn : null) }}
          onClick={() => setView('playlist')}
        >
          Playlist
        </button>
      </div>
    );
  }

  function renderPlaylistView() {
    return (
      <>
        {/* ── Left: playlist info column (replaces filters) ── */}
        <div style={styles.filterCol}>
          {renderViewToggle()}
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
                  {p.name} ({p.pitch_playlist_items?.[0]?.count ?? 0})
                </option>
              ))}
            </select>
            {activePlaylist && (
              <div style={styles.pairRow}>
                <button style={styles.plMgmtBtn} onClick={() => renamePlaylist(activePlaylist.id)}>Rename</button>
                <button style={{ ...styles.plMgmtBtn, color: '#fca5a5' }} onClick={() => deletePlaylist(activePlaylist.id)}>Delete</button>
              </div>
            )}
          </div>

          {playClip && (
            <div style={styles.playInfo}>
              <label style={styles.filterLabel}>Now playing</label>
              <div style={styles.playInfoName}>{flipName(playClip.player_name)}</div>
              <div style={styles.playInfoSub}>to {flipName(playClip.batter_name)}</div>
              <div style={styles.playInfoGrid}>
                <span style={styles.playInfoKey}>Pitch</span>
                <span>{playClip.pitch_name || playClip.pitch_type || '—'}</span>
                <span style={styles.playInfoKey}>Velo</span>
                <span>{playClip.release_speed ? `${playClip.release_speed.toFixed(1)} mph` : '—'}</span>
                <span style={styles.playInfoKey}>Count</span>
                <span>{playClip.balls ?? '–'}-{playClip.strikes ?? '–'}</span>
                <span style={styles.playInfoKey}>Result</span>
                <span>{outcome(playClip)}</span>
                <span style={styles.playInfoKey}>Game</span>
                <span>{playClip.away_team} @ {playClip.home_team}</span>
                <span style={styles.playInfoKey}>Date</span>
                <span>{playClip.game_date}</span>
                <span style={styles.playInfoKey}>Inning</span>
                <span>{playClip.inning_topbot} {playClip.inning}</span>
              </div>
              <a href={playClip.savant_url} target="_blank" rel="noreferrer" style={styles.link}>Savant ↗</a>
            </div>
          )}

          <div style={{ ...styles.filterField, flex: 1, minHeight: 0 }}>
            <label style={styles.filterLabel}>Queue ({playlistItems.length})</label>
            <div style={styles.queueList}>
              {playlistLoading && <div style={styles.drawerEmpty}>Loading…</div>}
              {!playlistLoading && !activePlaylistId && (
                <div style={styles.drawerEmpty}>Pick a playlist, or select pitches in Search and hit “Add to playlist”.</div>
              )}
              {!playlistLoading && activePlaylistId && playlistItems.length === 0 && (
                <div style={styles.drawerEmpty}>Empty — add pitches from the Search view.</div>
              )}
              {playlistItems.map((it, idx) => {
                const c = it.clip || {};
                const current = idx === playIndex;
                return (
                  <div
                    key={it.id}
                    style={{ ...styles.queueItem, ...(current ? styles.queueItemOn : null) }}
                    onClick={() => setPlayIndex(idx)}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={styles.queueItemTitle}>{idx + 1}. {flipName(c.player_name)}</div>
                      <div style={styles.queueItemSub}>
                        {c.pitch_name || c.pitch_type}{c.release_speed ? ` · ${c.release_speed.toFixed(1)}` : ''} · {outcome(c)}{!c.video_url ? ' · Savant' : ''}
                      </div>
                    </div>
                    <div style={styles.queueItemBtns} onClick={(e) => e.stopPropagation()}>
                      <button style={styles.queueBtn} onClick={() => movePlaylistItem(idx, -1)} disabled={idx === 0} title="Move up">↑</button>
                      <button style={styles.queueBtn} onClick={() => movePlaylistItem(idx, 1)} disabled={idx === playlistItems.length - 1} title="Move down">↓</button>
                      <button style={styles.queueBtn} onClick={() => removePlaylistItem(it.id)} title="Remove">×</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Center: player ── */}
        <div style={styles.playerCol}>
          {playClip && playSrc ? (
            <PlaylistPlayer
              key={playlistItems[playIndex]?.id}
              src={playSrc}
              index={playIndex}
              total={playlistItems.length}
              autoAdvance={autoAdvance}
              onToggleAutoAdvance={() => setAutoAdvance((v) => !v)}
              onPrev={() => setPlayIndex((i) => Math.max(0, i - 1))}
              onNext={() => setPlayIndex((i) => Math.min(playlistItems.length - 1, i + 1))}
              onEnded={() => { if (autoAdvance) setPlayIndex((i) => (i < playlistItems.length - 1 ? i + 1 : i)); }}
            />
          ) : playClip && savantMp4[playClipKey] === undefined ? (
            <div style={styles.placeholder}>Loading clip from Savant…</div>
          ) : playClip ? (
            <div style={styles.placeholder}>
              <div>
                No clip available for this pitch.{' '}
                <a href={playClip.savant_url} target="_blank" rel="noreferrer" style={styles.link}>Try Savant ↗</a>
              </div>
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '14px' }}>
                <button style={styles.navBtn} onClick={() => setPlayIndex((i) => Math.max(0, i - 1))} disabled={playIndex === 0}>‹ Prev</button>
                <button style={styles.navBtn} onClick={() => setPlayIndex((i) => Math.min(playlistItems.length - 1, i + 1))} disabled={playIndex >= playlistItems.length - 1}>Next ›</button>
              </div>
            </div>
          ) : (
            <div style={styles.placeholder}>
              {activePlaylistId ? 'This playlist is empty.' : 'Select a playlist on the left.'}
            </div>
          )}
        </div>
      </>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <button onClick={onBack} style={styles.backBtn} title="Back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <span style={styles.headerTitle}>Asset Search</span>
        <span style={styles.headerSub}>{section === 'pitches' ? 'Savant clip archive' : 'Shade drive'}</span>
        <div style={styles.viewTabs}>
          <button
            style={{ ...styles.viewTab, ...(section === 'pitches' ? styles.viewTabOn : null) }}
            onClick={() => setSection('pitches')}
          >
            Pitches
          </button>
          <button
            style={{ ...styles.viewTab, ...(section === 'assets' ? styles.viewTabOn : null) }}
            onClick={() => setSection('assets')}
          >
            Assets
          </button>
        </div>
        <div style={{ flex: 1 }} />
        {section === 'pitches' && view === 'search' && (
        <button
          style={{ ...styles.drawerToggle, ...(drawerOpen ? styles.drawerToggleOn : null) }}
          onClick={() => setDrawerOpen((o) => !o)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" />
          </svg>
          History
        </button>
        )}
      </div>

      <div style={styles.body}>
        {section === 'assets' && <ShadeAssets />}
        {section === 'pitches' && view === 'playlist' && renderPlaylistView()}
        {section === 'pitches' && view === 'search' && (<>
        {/* ── Left: filter column ── */}
        <div style={styles.filterCol}>
          {renderViewToggle()}
          <div style={styles.filterField}>
            <label style={styles.filterLabel}>Pitcher</label>
            <PlayerSearchField
              value={filters.pitcher}
              playerType="pitcher"
              placeholder="Search pitchers…"
              onChange={(v) => setF({ pitcher: v })}
            />
          </div>
          <div style={styles.filterField}>
            <label style={styles.filterLabel}>Batter</label>
            <PlayerSearchField
              value={filters.batter}
              playerType="batter"
              placeholder="Search batters…"
              onChange={(v) => setF({ batter: v })}
            />
          </div>
          <div style={styles.filterField}>
            <label style={styles.filterLabel}>Team</label>
            <input style={styles.input} value={filters.team} maxLength={3} placeholder="e.g. PIT" onChange={(e) => setF({ team: e.target.value })} />
          </div>
          <div style={styles.filterField}>
            <label style={styles.filterLabel}>Pitch types</label>
            <div style={styles.chipRow}>
              {PITCH_TYPES.map(([code, name]) => {
                const on = filters.pitchTypes.includes(code);
                return (
                  <button
                    key={code}
                    title={name}
                    onClick={() => setF({
                      pitchTypes: on
                        ? filters.pitchTypes.filter((c) => c !== code)
                        : [...filters.pitchTypes, code],
                    })}
                    style={{ ...styles.chip, ...(on ? styles.chipOn : null) }}
                  >
                    {code}
                  </button>
                );
              })}
            </div>
          </div>
          <div style={styles.filterField}>
            <label style={styles.filterLabel}>Result (event)</label>
            <select style={styles.input} value={filters.event} onChange={(e) => setF({ event: e.target.value })}>
              <option value="">Any</option>
              {EVENTS.map((ev) => <option key={ev} value={ev}>{label(ev)}</option>)}
            </select>
          </div>
          <div style={styles.filterField}>
            <label style={styles.filterLabel}>Pitch result</label>
            <select style={styles.input} value={filters.description} onChange={(e) => setF({ description: e.target.value })}>
              <option value="">Any</option>
              {DESCRIPTIONS.map((d) => <option key={d} value={d}>{label(d)}</option>)}
            </select>
          </div>
          <div style={styles.filterField}>
            <label style={styles.filterLabel}>Season</label>
            <input style={styles.input} value={filters.gameYear} placeholder="2026" onChange={(e) => setF({ gameYear: e.target.value.replace(/\D/g, '').slice(0, 4) })} />
          </div>
          <div style={styles.filterField}>
            <label style={styles.filterLabel}>Date from / to</label>
            <input type="date" style={styles.input} value={filters.dateFrom} onChange={(e) => setF({ dateFrom: e.target.value })} />
            <input type="date" style={{ ...styles.input, marginTop: '6px' }} value={filters.dateTo} onChange={(e) => setF({ dateTo: e.target.value })} />
          </div>
          <div style={styles.filterField}>
            <label style={styles.filterLabel}>Velo (mph)</label>
            <div style={styles.pairRow}>
              <input style={styles.input} value={filters.veloMin} placeholder="min" onChange={(e) => setF({ veloMin: e.target.value.replace(/[^\d.]/g, '') })} />
              <input style={styles.input} value={filters.veloMax} placeholder="max" onChange={(e) => setF({ veloMax: e.target.value.replace(/[^\d.]/g, '') })} />
            </div>
          </div>
          <div style={styles.filterField}>
            <label style={styles.filterLabel}>Count (B-S)</label>
            <div style={styles.pairRow}>
              <select style={styles.input} value={filters.balls} onChange={(e) => setF({ balls: e.target.value })}>
                <option value="">B</option>
                {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <select style={styles.input} value={filters.strikes} onChange={(e) => setF({ strikes: e.target.value })}>
                <option value="">S</option>
                {[0, 1, 2].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>
          <div style={styles.filterField}>
            <label style={styles.filterLabel}>Sides</label>
            <div style={styles.pairRow}>
              <select style={styles.input} value={filters.stand} onChange={(e) => setF({ stand: e.target.value })}>
                <option value="">Bat: any</option>
                <option value="L">Bat: L</option>
                <option value="R">Bat: R</option>
              </select>
              <select style={styles.input} value={filters.pThrows} onChange={(e) => setF({ pThrows: e.target.value })}>
                <option value="">Thr: any</option>
                <option value="L">Thr: L</option>
                <option value="R">Thr: R</option>
              </select>
            </div>
          </div>
          <div style={styles.filterField}>
            <label style={styles.filterLabel}>Inning</label>
            <input style={styles.input} value={filters.inning} placeholder="any" onChange={(e) => setF({ inning: e.target.value.replace(/\D/g, '').slice(0, 2) })} />
          </div>
          <label style={styles.archToggle}>
            <input type="checkbox" checked={filters.onlyArchived} onChange={(e) => setF({ onlyArchived: e.target.checked })} />
            Archived only
          </label>

          <div style={styles.filterActions}>
            <button style={styles.clearFiltersBtn} onClick={() => setFilters(EMPTY_FILTERS)}>Clear</button>
            <button style={styles.searchBtn} onClick={runSearch} disabled={searching}>
              {searching ? 'Searching…' : 'Search'}
            </button>
          </div>
          {searchError && <div style={styles.errorMsg}>{searchError}</div>}
        </div>

        {/* ── Center: results ── */}
        <div style={styles.resultsCol}>
          {rows === null ? (
            <div style={styles.placeholder}>Set filters on the left and run a search.</div>
          ) : (
            <>
              <div style={styles.resultsBar}>
                <span style={styles.resultsCount}>
                  {rows.length} pitches · {archivedRows.length} with video
                  {selectedAnyRows.length > 0 && ` · ${selectedAnyRows.length} selected`}
                </span>
                <div style={{ flex: 1 }} />
                {batch ? (
                  <>
                    <span style={styles.batchProgress}>
                      Downloading {batch.done}/{batch.total}{batch.failed ? ` (${batch.failed} failed)` : ''}
                    </span>
                    <button style={styles.clearFiltersBtn} onClick={() => { batchCancelRef.current = true; }}>Cancel</button>
                  </>
                ) : selectedAnyRows.length > 0 ? (
                  <>
                    <button style={styles.batchBtn} onClick={openPlaylist}>View selected</button>
                    <button style={styles.batchBtn} onClick={() => setAddPicker({ rows: selectedAnyRows })}>Add to playlist</button>
                    <button style={styles.batchBtn} onClick={() => runBatchDownload(selectedAnyRows)}>Download</button>
                    {selectedRows.length > 0 && (
                      <button style={styles.batchBtn} onClick={() => openDrivePicker(selectedRows)}>Upload to Drive</button>
                    )}
                    <button style={styles.clearFiltersBtn} onClick={() => setSelectedKeys(new Set())}>Clear</button>
                  </>
                ) : archivedRows.length > 0 && (
                  <>
                    <button style={styles.batchBtn} onClick={() => runBatchDownload(archivedRows)}>Download all ({archivedRows.length})</button>
                    <button style={styles.batchBtn} onClick={() => openDrivePicker(archivedRows)}>Upload all to Drive</button>
                  </>
                )}
              </div>

              <div style={styles.tableScroll}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={{ ...styles.th, width: '34px' }}>
                        <input type="checkbox" checked={allSelected} onChange={toggleAll} title="Select all" />
                      </th>
                      {['Date', 'Pitcher', 'Batter', 'Pitch', 'Velo', 'Count', 'Inn', 'Result', ''].map((h, i) => (
                        <th key={i} style={styles.th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const key = rowKey(row);
                      const checked = selectedKeys.has(key);
                      return (
                        <tr
                          key={key}
                          onClick={() => openSingle(row)}
                          style={{ ...styles.tr, ...(checked ? styles.trSelected : null) }}
                        >
                          <td style={styles.td} onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" checked={checked} onChange={() => toggleKey(key)} />
                          </td>
                          <td style={styles.td}>{row.game_date}</td>
                          <td style={styles.td}>{row.player_name}</td>
                          <td style={styles.td}>{row.batter_name}</td>
                          <td style={styles.td}>{row.pitch_type || '—'}</td>
                          <td style={styles.td}>{row.release_speed ? row.release_speed.toFixed(1) : '—'}</td>
                          <td style={styles.td}>{row.balls ?? '–'}-{row.strikes ?? '–'}</td>
                          <td style={styles.td}>{row.inning ?? '—'}</td>
                          <td style={styles.td}>{outcome(row)}</td>
                          <td style={{ ...styles.td, textAlign: 'right', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                            {!row.video_url && (
                              <span style={{ ...styles.pendingTag, marginRight: '6px' }} title={`Status: ${row.status || 'not archived'} — downloads via Savant CDN`}>{row.status || 'not archived'}</span>
                            )}
                            <button style={styles.rowBtn} title={row.video_url ? 'Download clip' : 'Download via Savant'} onClick={() => downloadClip(row)}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                              </svg>
                            </button>
                            {row.video_url && (
                              <button style={{ ...styles.rowBtn, marginLeft: '5px' }} title="Upload to Drive" onClick={() => openDrivePicker([row])}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                                </svg>
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {rows.length === 0 && (
                      <tr><td colSpan={10} style={styles.emptyCell}>No pitches matched these filters.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {/* ── Right: history drawer ── */}
        {drawerOpen && (
          <div style={styles.drawer}>
            <div style={styles.drawerHeader}>
              <span style={styles.drawerTitle}>Search History</span>
              <button style={styles.drawerClose} onClick={() => setDrawerOpen(false)} title="Collapse">×</button>
            </div>
            <div style={styles.drawerList}>
              {history.length === 0 && <div style={styles.drawerEmpty}>No searches yet.</div>}
              {history.map((entry) => (
                <button key={entry.id} style={styles.historyItem} onClick={() => applyHistoryEntry(entry)}>
                  <div style={styles.historyTop}>
                    <span style={styles.historyUser}>{entry.user_name || 'Unknown'}</span>
                    <span style={styles.historyTime}>{timeAgo(entry.created_at)}</span>
                  </div>
                  <div style={styles.historySummary}>{summarizeFilters(entry.filters || {})}</div>
                  {entry.result_count != null && (
                    <div style={styles.historyCount}>{entry.result_count} results</div>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
        </>)}
      </div>

      {/* ── Review modal ── */}
      {modal && modalClip && (
        <div style={styles.modalBackdrop} onClick={() => setModal(null)}>
          <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <div style={styles.modalTitle}>
                {flipName(modalClip.player_name)} to {flipName(modalClip.batter_name)}
                <span style={styles.modalSub}>
                  {' '}· {modalClip.pitch_name || modalClip.pitch_type}{modalClip.release_speed ? ` ${modalClip.release_speed.toFixed(1)} mph` : ''}
                  {' '}· {modalClip.balls ?? '–'}-{modalClip.strikes ?? '–'} · {outcome(modalClip)}
                </span>
              </div>
              <button style={styles.drawerClose} onClick={() => setModal(null)} title="Close">×</button>
            </div>
            {(modalClip.video_url || savantMp4[rowKey(modalClip)]) ? (
              <video
                key={rowKey(modalClip)}
                src={modalClip.video_url || savantMp4[rowKey(modalClip)]}
                controls
                autoPlay
                onEnded={() => { if (modal.index < modal.clips.length - 1) modalNext(); }}
                style={styles.modalVideo}
              />
            ) : resolvingKey === rowKey(modalClip) ? (
              <div style={styles.noVideo}>Loading clip from Savant…</div>
            ) : (
              <div style={styles.noVideo}>
                No clip available for this pitch ({modalClip.status}).{' '}
                <a href={modalClip.savant_url} target="_blank" rel="noreferrer" style={styles.link}>Try Savant</a>
              </div>
            )}
            <div style={styles.modalFooter}>
              <span style={styles.modalMeta}>
                {modalClip.away_team} @ {modalClip.home_team} · {modalClip.game_date} · {modalClip.inning_topbot} {modalClip.inning}
              </span>
              <div style={{ flex: 1 }} />
              {modal.clips.length > 1 && (
                <>
                  <button style={styles.navBtn} onClick={modalPrev} disabled={modal.index === 0}>‹ Prev</button>
                  <span style={styles.modalCounter}>{modal.index + 1} / {modal.clips.length}</span>
                  <button style={styles.navBtn} onClick={modalNext} disabled={modal.index === modal.clips.length - 1}>Next ›</button>
                </>
              )}
              <button style={styles.batchBtn} onClick={() => downloadClip(modalClip)}>Download</button>
              {modalClip.video_url && (
                <button style={styles.batchBtn} onClick={() => openDrivePicker([modalClip])}>Upload to Drive</button>
              )}
              <a href={modalClip.savant_url} target="_blank" rel="noreferrer" style={styles.link}>Savant ↗</a>
            </div>
          </div>
        </div>
      )}

      {/* ── Add-to-playlist picker modal ── */}
      {addPicker && (
        <div style={styles.modalBackdrop} onClick={() => !addBusy && setAddPicker(null)}>
          <div style={{ ...styles.modalCard, width: '420px' }} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <div style={styles.modalTitle}>
                Add {addPicker.rows.length} clip{addPicker.rows.length > 1 ? 's' : ''} to playlist
              </div>
              <button style={styles.drawerClose} onClick={() => setAddPicker(null)} title="Close">×</button>
            </div>
            <div style={styles.playlistPickList}>
              {playlists.map((p) => (
                <button
                  key={p.id}
                  style={styles.playlistPickItem}
                  disabled={addBusy}
                  onClick={() => addRowsToPlaylist(p.id, addPicker.rows)}
                >
                  <span>{p.name}</span>
                  <span style={styles.playlistPickCount}>{p.pitch_playlist_items?.[0]?.count ?? 0}</span>
                </button>
              ))}
              {playlists.length === 0 && (
                <div style={styles.drawerEmpty}>No playlists yet — create one below.</div>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px', padding: '4px 16px 16px' }}>
              <input
                style={styles.input}
                value={newPlaylistName}
                placeholder="New playlist name"
                onChange={(e) => setNewPlaylistName(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
              <button
                style={styles.batchBtn}
                disabled={addBusy || !newPlaylistName.trim()}
                onClick={async () => {
                  const pl = await createPlaylist(newPlaylistName);
                  if (pl) {
                    setNewPlaylistName('');
                    await addRowsToPlaylist(pl.id, addPicker.rows);
                    setActivePlaylistId(pl.id);
                  }
                }}
              >
                Create + add
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Drive picker modal ── */}
      {drivePicker && (
        <div style={styles.modalBackdrop} onClick={() => !uploadState && setDrivePicker(null)}>
          <div style={{ ...styles.modalCard, width: '520px' }} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <div style={styles.modalTitle}>
                Upload {drivePicker.rows.length} clip{drivePicker.rows.length > 1 ? 's' : ''} to Drive
              </div>
              <button style={styles.drawerClose} onClick={() => setDrivePicker(null)} title="Close">×</button>
            </div>

            {uploadState ? (
              <div style={styles.uploadStatus}>
                {uploadState.done < uploadState.total ? (
                  <>
                    <div style={styles.uploadBarOuter}>
                      <div style={{ ...styles.uploadBarInner, width: `${(uploadState.done / uploadState.total) * 100}%` }} />
                    </div>
                    <div style={styles.uploadLabel}>
                      Uploading {uploadState.done + 1}/{uploadState.total}
                      {uploadState.failed ? ` · ${uploadState.failed} failed` : ''}
                    </div>
                    {uploadState.current && <div style={styles.uploadCurrent}>{uploadState.current}</div>}
                  </>
                ) : (
                  <>
                    <div style={styles.uploadDone}>
                      {uploadState.total - uploadState.failed}/{uploadState.total} uploaded
                      {uploadState.failed ? ` — ${uploadState.failed} failed` : ' ✓'}
                    </div>
                    <button style={styles.searchBtn} onClick={() => setDrivePicker(null)}>Done</button>
                  </>
                )}
              </div>
            ) : (
              <>
                <div style={styles.crumbRow}>
                  {drivePath.map((crumb, i) => (
                    <React.Fragment key={crumb.id}>
                      {i > 0 && <span style={styles.crumbSep}>/</span>}
                      <button style={styles.crumb} onClick={() => jumpToCrumb(i)}>{crumb.name}</button>
                    </React.Fragment>
                  ))}
                </div>

                <div style={styles.folderList}>
                  {driveLoading && <div style={styles.drawerEmpty}>Loading…</div>}
                  {!driveLoading && driveFolders.length === 0 && (
                    <div style={styles.drawerEmpty}>No subfolders.</div>
                  )}
                  {!driveLoading && driveFolders.map((f) => (
                    <button key={f.id} style={styles.folderItem} onClick={() => enterFolder(f)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                      </svg>
                      {f.name}
                    </button>
                  ))}
                </div>

                <div style={styles.newFolderRow}>
                  <input
                    style={styles.input}
                    value={newFolderName}
                    placeholder="New folder name…"
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') createFolder(); }}
                  />
                  <button style={styles.clearFiltersBtn} onClick={createFolder} disabled={creatingFolder || !newFolderName.trim()}>
                    {creatingFolder ? 'Creating…' : 'Create'}
                  </button>
                </div>

                {driveError && <div style={styles.errorMsg}>{driveError}</div>}

                <div style={styles.modalFooter}>
                  <span style={styles.modalMeta}>Destination: {drivePath[drivePath.length - 1].name}</span>
                  <div style={{ flex: 1 }} />
                  <button style={styles.searchBtn} onClick={uploadToDrive}>Upload here</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Playlist player ─────────────────────────────────────────────────────────
// Custom <video> chrome: scrubber, quarter/half/normal/double speed, and
// single-frame stepping. Savant broadcast clips are ~30fps, so a "frame"
// is 1/30s (the <video> element exposes no real frame API).
const PLAYBACK_RATES = [0.25, 0.5, 1, 2];
const FRAME_S = 1 / 30;

function PlaylistPlayer({ src, index, total, autoAdvance, onToggleAutoAdvance, onPrev, onNext, onEnded }) {
  const videoRef = useRef(null);
  const wrapRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);

  const setPlaybackRate = useCallback((r) => {
    setRate(r);
    if (videoRef.current) videoRef.current.playbackRate = r;
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {}); else v.pause();
  }, []);

  const stepFrame = useCallback((dir) => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    const max = isFinite(v.duration) ? v.duration : Number.MAX_SAFE_INTEGER;
    v.currentTime = Math.min(Math.max(0, v.currentTime + dir * FRAME_S), max);
  }, []);

  // Keyboard: ←→ frame step · ↑↓ prev/next clip · space play/pause ·
  // , ¼× · . ½× · / 1×
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); stepFrame(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); stepFrame(-1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); onPrev(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); onNext(); }
      else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
      else if (e.key === ',') setPlaybackRate(0.25);
      else if (e.key === '.') setPlaybackRate(0.5);
      else if (e.key === '/') setPlaybackRate(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stepFrame, togglePlay, onPrev, onNext, setPlaybackRate]);

  const fmt = (s) => {
    if (!isFinite(s)) return '0:00.00';
    const m = Math.floor(s / 60);
    return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}`;
  };

  return (
    <div ref={wrapRef} style={styles.playerWrap}>
      <video
        ref={videoRef}
        src={src}
        autoPlay
        muted={muted}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.target.currentTime)}
        onLoadedMetadata={(e) => { setDuration(e.target.duration || 0); e.target.playbackRate = rate; }}
        onEnded={onEnded}
        onClick={togglePlay}
        style={styles.playerVideo}
      />
      <div style={styles.playerControls}>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={FRAME_S}
          value={Math.min(time, duration || 0)}
          onChange={(e) => {
            const v = videoRef.current;
            if (v) v.currentTime = Number(e.target.value);
            setTime(Number(e.target.value));
          }}
          style={styles.scrubber}
        />
        <div style={styles.controlRow}>
          <button style={styles.ctrlBtn} onClick={onPrev} disabled={index === 0} title="Previous clip (↑)">⏮</button>
          <button style={styles.ctrlBtn} onClick={() => stepFrame(-1)} title="Frame back (←)">‹｜</button>
          <button style={{ ...styles.ctrlBtn, ...styles.playBtn }} onClick={togglePlay} title="Play / pause (space)">
            {playing ? '❚❚' : '▶'}
          </button>
          <button style={styles.ctrlBtn} onClick={() => stepFrame(1)} title="Frame forward (→)">｜›</button>
          <button style={styles.ctrlBtn} onClick={onNext} disabled={index >= total - 1} title="Next clip (↓)">⏭</button>
          <span style={styles.timeLabel}>{fmt(time)} / {fmt(duration)}</span>
          <div style={{ flex: 1 }} />
          {PLAYBACK_RATES.map((r) => (
            <button
              key={r}
              style={{ ...styles.rateBtn, ...(rate === r ? styles.rateBtnOn : null) }}
              onClick={() => setPlaybackRate(r)}
              title={r === 0.25 ? 'Quarter speed (,)' : r === 0.5 ? 'Half speed (.)' : r === 1 ? 'Normal speed (/)' : 'Double speed'}
            >
              {r === 0.25 ? '¼×' : r === 0.5 ? '½×' : `${r}×`}
            </button>
          ))}
          <button style={styles.ctrlBtn} onClick={() => setMuted((m) => !m)} title={muted ? 'Unmute' : 'Mute'}>
            {muted ? '🔇' : '🔊'}
          </button>
          <button style={styles.ctrlBtn} onClick={() => wrapRef.current?.requestFullscreen?.()} title="Fullscreen">⛶</button>
          <label style={styles.autoAdvToggle} title="Play the next clip automatically when this one ends">
            <input type="checkbox" checked={autoAdvance} onChange={onToggleAutoAdvance} />
            Auto-advance
          </label>
          <span style={styles.counterLabel}>{index + 1} / {total}</span>
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
    background: '#0f0f1a',
    color: '#e2e8f0',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '20px 32px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  backBtn: {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '8px',
    color: '#e2e8f0',
    width: '34px',
    height: '34px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  headerTitle: { fontSize: '18px', fontWeight: 700 },
  headerSub: { fontSize: '13px', color: 'rgba(255,255,255,0.35)' },
  drawerToggle: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '8px',
    color: 'rgba(255,255,255,0.6)',
    padding: '7px 14px',
    fontSize: '13px',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  drawerToggleOn: {
    background: 'rgba(99,102,241,0.15)',
    borderColor: 'rgba(99,102,241,0.4)',
    color: '#a5b4fc',
  },
  body: {
    display: 'flex',
    flex: 1,
    minHeight: 0,
    alignItems: 'stretch',
  },
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
  },
  pairRow: { display: 'flex', gap: '6px' },
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
  archToggle: {
    display: 'flex',
    alignItems: 'center',
    gap: '7px',
    fontSize: '13px',
    color: 'rgba(255,255,255,0.6)',
    cursor: 'pointer',
  },
  filterActions: { display: 'flex', gap: '8px' },
  clearFiltersBtn: {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '8px',
    color: 'rgba(255,255,255,0.6)',
    padding: '8px 16px',
    fontSize: '13px',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  searchBtn: {
    background: '#6366f1',
    border: 'none',
    borderRadius: '8px',
    color: '#fff',
    padding: '8px 22px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    flex: 1,
  },
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
  batchProgress: { fontSize: '13px', color: '#a5b4fc' },
  errorMsg: { color: '#f87171', fontSize: '13px' },
  resultsCol: {
    flex: 1,
    minWidth: 0,
    padding: '18px 24px',
    display: 'flex',
    flexDirection: 'column',
  },
  placeholder: {
    padding: '80px 20px',
    textAlign: 'center',
    color: 'rgba(255,255,255,0.3)',
    fontSize: '14px',
  },
  resultsBar: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' },
  resultsCount: { fontSize: '13px', color: 'rgba(255,255,255,0.45)' },
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
  },
  pendingTag: { fontSize: '11px', color: 'rgba(255,255,255,0.3)', fontStyle: 'italic' },
  emptyCell: { padding: '28px', textAlign: 'center', color: 'rgba(255,255,255,0.35)' },
  drawer: {
    width: '320px',
    flexShrink: 0,
    borderLeft: '1px solid rgba(255,255,255,0.06)',
    display: 'flex',
    flexDirection: 'column',
    maxHeight: 'calc(100vh - 75px)',
  },
  drawerHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 16px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  drawerTitle: { fontSize: '14px', fontWeight: 700 },
  drawerClose: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.4)',
    fontSize: '20px',
    cursor: 'pointer',
    lineHeight: 1,
    padding: '2px 6px',
  },
  drawerList: { overflowY: 'auto', flex: 1, padding: '8px' },
  drawerEmpty: { padding: '24px', textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: '13px' },
  historyItem: {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '10px',
    padding: '10px 12px',
    marginBottom: '8px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    color: '#e2e8f0',
  },
  historyTop: { display: 'flex', justifyContent: 'space-between', marginBottom: '4px' },
  historyUser: { fontSize: '12px', fontWeight: 700, color: '#a5b4fc' },
  historyTime: { fontSize: '11px', color: 'rgba(255,255,255,0.3)' },
  historySummary: { fontSize: '12px', color: 'rgba(255,255,255,0.7)', lineHeight: 1.4 },
  historyCount: { fontSize: '11px', color: 'rgba(255,255,255,0.35)', marginTop: '3px' },
  modalBackdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modalCard: {
    background: '#16162a',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '14px',
    width: '720px',
    maxWidth: '92vw',
    maxHeight: '90vh',
    overflow: 'auto',
    padding: '16px',
  },
  modalHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '12px' },
  modalTitle: { fontSize: '15px', fontWeight: 700 },
  modalSub: { fontWeight: 400, color: 'rgba(255,255,255,0.5)', fontSize: '13px' },
  modalVideo: { width: '100%', borderRadius: '10px', background: '#000' },
  modalFooter: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '12px', flexWrap: 'wrap' },
  modalMeta: { fontSize: '12px', color: 'rgba(255,255,255,0.4)' },
  modalCounter: { fontSize: '13px', color: 'rgba(255,255,255,0.6)', minWidth: '52px', textAlign: 'center' },
  navBtn: {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '8px',
    color: '#e2e8f0',
    padding: '7px 14px',
    fontSize: '13px',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  noVideo: {
    padding: '40px 20px',
    textAlign: 'center',
    background: 'rgba(255,255,255,0.02)',
    borderRadius: '10px',
    color: 'rgba(255,255,255,0.5)',
    fontSize: '13px',
  },
  link: { color: '#a5b4fc', fontSize: '13px', textDecoration: 'none' },
  crumbRow: { display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap', marginBottom: '10px' },
  crumb: {
    background: 'none',
    border: 'none',
    color: '#a5b4fc',
    fontSize: '13px',
    cursor: 'pointer',
    padding: '2px 4px',
    fontFamily: 'inherit',
  },
  crumbSep: { color: 'rgba(255,255,255,0.3)', fontSize: '13px' },
  folderList: {
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '10px',
    maxHeight: '260px',
    overflowY: 'auto',
    marginBottom: '10px',
  },
  folderItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    width: '100%',
    textAlign: 'left',
    background: 'none',
    border: 'none',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
    color: '#e2e8f0',
    padding: '9px 12px',
    fontSize: '13px',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  newFolderRow: { display: 'flex', gap: '8px', marginBottom: '6px' },
  uploadStatus: { padding: '20px 8px', display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'stretch' },
  uploadBarOuter: {
    height: '8px',
    borderRadius: '999px',
    background: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
  },
  uploadBarInner: { height: '100%', background: '#6366f1', transition: 'width 0.25s' },
  uploadLabel: { fontSize: '13px', color: 'rgba(255,255,255,0.7)' },
  uploadCurrent: { fontSize: '12px', color: 'rgba(255,255,255,0.4)', wordBreak: 'break-all' },
  uploadDone: { fontSize: '14px', fontWeight: 600, color: '#a5b4fc', textAlign: 'center' },

  // ── Playlist view ──
  viewTabs: {
    display: 'flex',
    gap: '4px',
    marginLeft: '16px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '8px',
    padding: '3px',
  },
  viewTab: {
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
  plMgmtBtn: {
    flex: 1,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '8px',
    color: 'rgba(255,255,255,0.6)',
    padding: '5px 8px',
    fontSize: '12px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    marginTop: '6px',
  },
  playInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '10px',
    padding: '12px',
  },
  playInfoName: { fontSize: '15px', fontWeight: 700, color: '#fff' },
  playInfoSub: { fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginBottom: '6px' },
  playInfoGrid: {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr',
    columnGap: '12px',
    rowGap: '4px',
    fontSize: '12px',
    color: 'rgba(255,255,255,0.75)',
    marginBottom: '6px',
  },
  playInfoKey: {
    color: 'rgba(255,255,255,0.35)',
    textTransform: 'uppercase',
    fontSize: '10px',
    letterSpacing: '0.4px',
    alignSelf: 'center',
  },
  queueList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    overflowY: 'auto',
    minHeight: 0,
    flex: 1,
  },
  queueItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.05)',
    borderRadius: '8px',
    padding: '7px 9px',
    cursor: 'pointer',
  },
  queueItemOn: {
    background: 'rgba(99,102,241,0.14)',
    borderColor: 'rgba(99,102,241,0.45)',
  },
  queueItemTitle: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#e2e8f0',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  queueItemSub: {
    fontSize: '11px',
    color: 'rgba(255,255,255,0.4)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  queueItemBtns: { display: 'flex', gap: '2px', flexShrink: 0 },
  queueBtn: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.35)',
    cursor: 'pointer',
    fontSize: '12px',
    padding: '2px 4px',
    fontFamily: 'inherit',
  },
  playerCol: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    padding: '18px 24px',
  },
  playerWrap: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minHeight: 0,
    background: '#000',
    borderRadius: '12px',
    overflow: 'hidden',
    border: '1px solid rgba(255,255,255,0.08)',
  },
  playerVideo: {
    flex: 1,
    minHeight: 0,
    width: '100%',
    objectFit: 'contain',
    background: '#000',
    cursor: 'pointer',
  },
  playerControls: {
    background: 'rgba(15,15,26,0.98)',
    borderTop: '1px solid rgba(255,255,255,0.08)',
    padding: '8px 14px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  scrubber: { width: '100%', accentColor: '#6366f1', cursor: 'pointer' },
  controlRow: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' },
  ctrlBtn: {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '7px',
    color: '#e2e8f0',
    padding: '5px 9px',
    fontSize: '13px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    lineHeight: 1,
  },
  playBtn: {
    background: 'rgba(99,102,241,0.2)',
    borderColor: 'rgba(99,102,241,0.5)',
    color: '#a5b4fc',
    padding: '5px 14px',
  },
  rateBtn: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '999px',
    color: 'rgba(255,255,255,0.5)',
    padding: '4px 10px',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  rateBtnOn: {
    background: 'rgba(99,102,241,0.18)',
    borderColor: 'rgba(99,102,241,0.5)',
    color: '#a5b4fc',
  },
  timeLabel: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.55)',
    fontVariantNumeric: 'tabular-nums',
    marginLeft: '6px',
  },
  counterLabel: { fontSize: '12px', color: 'rgba(255,255,255,0.4)', marginLeft: '4px' },
  autoAdvToggle: {
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    fontSize: '12px',
    color: 'rgba(255,255,255,0.6)',
    cursor: 'pointer',
    marginLeft: '8px',
    userSelect: 'none',
  },
  playlistPickList: {
    display: 'flex',
    flexDirection: 'column',
    maxHeight: '280px',
    overflowY: 'auto',
    padding: '4px 16px 12px',
    gap: '4px',
  },
  playlistPickItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '8px',
    color: '#e2e8f0',
    padding: '9px 12px',
    fontSize: '13px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'left',
  },
  playlistPickCount: { fontSize: '11px', color: 'rgba(255,255,255,0.35)' },
};
