import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../contexts/ConfirmContext';
import useVisibilityRefresh from '../hooks/useVisibilityRefresh';
import CanvasBoard from './editors/CanvasBoard';
import ReviewPlayer from '../components/reviews/ReviewPlayer';
import { clickableKeyProps, modalOverlay, modal as modalShell } from '../lib/styleRecipes';
import backdropDismiss from '../lib/backdropDismiss';
import { colors } from '../lib/styleTokens';

const FN_URL = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/google-drive-resources`;

// Pull the 11-char video id out of any of the shapes people actually paste:
// watch?v=, youtu.be/, /embed/, /shorts/, /live/, or the bare id. Extra query
// params (?t=, ?si=, playlist ids) are ignored. Returns null if there's no id,
// which is what gates the save button.
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
export function parseYouTubeId(input) {
  const raw = (input || '').trim();
  if (!raw) return null;
  if (YOUTUBE_ID.test(raw)) return raw;
  let url;
  try {
    url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, '');
  if (host === 'youtu.be') {
    const id = url.pathname.split('/')[1];
    return YOUTUBE_ID.test(id) ? id : null;
  }
  if (host !== 'youtube.com' && host !== 'm.youtube.com' && host !== 'youtube-nocookie.com') return null;
  const v = url.searchParams.get('v');
  if (v && YOUTUBE_ID.test(v)) return v;
  const segments = url.pathname.split('/').filter(Boolean);
  if (['embed', 'shorts', 'live', 'v'].includes(segments[0]) && YOUTUBE_ID.test(segments[1])) {
    return segments[1];
  }
  return null;
}

export default function Resources() {
  // isAdmin is the admin tier — admin + director — which is exactly who gets
  // the New Guide button (and what the RLS policies check).
  const { profile, isAdmin } = useAuth();
  const confirm = useConfirm();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rootId, setRootId] = useState(null);
  const [path, setPath] = useState([]); // breadcrumb stack: [{ id, name }]

  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [showCreateDoc, setShowCreateDoc] = useState(false);
  const [docTitle, setDocTitle] = useState('');
  const [busy, setBusy] = useState(false);

  // Canvases section (root level only — canvases aren't tied to Drive folders)
  const [canvases, setCanvases] = useState([]);
  const [showCreateCanvas, setShowCreateCanvas] = useState(false);
  const [canvasTitle, setCanvasTitle] = useState('');
  const [openCanvas, setOpenCanvas] = useState(null); // { id, title }

  // Guides — admin-tier posts a titled YouTube link, all staff can watch.
  // Two kinds: 'video' is a plain embed; 'walkthrough' is backed by a
  // reviews row (kind = 'guide') so staff can leave timestamped notes on it
  // with the Review player.
  const [guides, setGuides] = useState([]);
  const [showGuideModal, setShowGuideModal] = useState(false);
  const [guideKind, setGuideKind] = useState('video');
  const [guideTitle, setGuideTitle] = useState('');
  const [guideUrl, setGuideUrl] = useState('');
  const [guideError, setGuideError] = useState(null);
  const [playingGuide, setPlayingGuide] = useState(null); // plain guide row being watched
  const [openWalkthrough, setOpenWalkthrough] = useState(null); // { guide, review } in the Review player
  const [openingGuideId, setOpeningGuideId] = useState(null); // walkthrough review being fetched
  const [hoveredGuideId, setHoveredGuideId] = useState(null);

  const [contextMenu, setContextMenu] = useState(null); // { x, y, item }
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');

  const currentFolderId = path.length > 0 ? path[path.length - 1].id : rootId;

  const callFn = useCallback(async (method, query, body) => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) throw new Error('Not authenticated');

    const url = query ? `${FN_URL}?${query}` : FN_URL;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }, []);

  const loadSeqRef = useRef(0);
  const fetchItems = useCallback(async (folderId) => {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const query = folderId ? `folderId=${encodeURIComponent(folderId)}` : '';
      const data = await callFn('GET', query);
      if (seq !== loadSeqRef.current) return; // a newer navigation superseded this
      setItems(data.items || []);
      if (!rootId && data.rootId) setRootId(data.rootId);
    } catch (err) {
      if (seq !== loadSeqRef.current) return; // a newer navigation superseded this
      console.error('Error fetching Drive items:', err);
      setError(err.message);
      setItems([]);
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, [callFn, rootId]);

  useEffect(() => {
    if (!profile?.id) return;
    fetchItems(currentFolderId || null);
  }, [profile?.id, currentFolderId, fetchItems]);

  useVisibilityRefresh(() => {
    fetchItems(currentFolderId || null);
    fetchCanvases();
  });

  const fetchCanvases = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('canvases')
      .select('id, title, updated_at, creator:profiles!created_by(full_name)')
      .order('updated_at', { ascending: false });
    if (err) console.error('Error fetching canvases:', err);
    setCanvases(data || []);
  }, []);

  useEffect(() => {
    if (profile?.id) fetchCanvases();
  }, [profile?.id, fetchCanvases]);

  // A video filling most of the screen should close on Escape, not just on a
  // backdrop click.
  useEffect(() => {
    if (!playingGuide) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setPlayingGuide(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playingGuide]);

  const fetchGuides = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('resource_guides')
      .select('id, title, youtube_url, youtube_id, review_id, created_at')
      .order('position', { ascending: true })
      .order('created_at', { ascending: false });
    if (err) { console.error('Error fetching guides:', err); return; }
    setGuides(data || []);
  }, []);

  useEffect(() => {
    if (profile?.id) fetchGuides();
  }, [profile?.id, fetchGuides]);

  async function handleCreateGuide(e) {
    e.preventDefault();
    if (busy) return;
    const title = guideTitle.trim();
    const youtubeId = parseYouTubeId(guideUrl);
    if (!title) { setGuideError('Give the guide a title.'); return; }
    if (!youtubeId) { setGuideError("That doesn't look like a YouTube link."); return; }
    setBusy(true);
    setGuideError(null);
    const url = guideUrl.trim();
    let reviewId = null;
    if (guideKind === 'walkthrough') {
      // The review + its first version carry the video; the guide row only
      // points at the review. If a later step fails, drop the review so no
      // orphan hides behind the Reviews page's kind filter.
      const { data: review, error: revErr } = await supabase
        .from('reviews')
        .insert({ title, kind: 'guide', youtube_url: url, youtube_video_id: youtubeId, created_by: profile.id })
        .select('id')
        .single();
      if (revErr) { setBusy(false); setGuideError(revErr.message); return; }
      reviewId = review.id;
      const { error: verErr } = await supabase.from('review_versions').insert({
        review_id: reviewId,
        version_number: 1,
        label: 'Guide',
        youtube_url: url,
        youtube_video_id: youtubeId,
        created_by: profile.id,
      });
      if (verErr) {
        await supabase.from('reviews').delete().eq('id', reviewId);
        setBusy(false);
        setGuideError(verErr.message);
        return;
      }
    }
    const { error: err } = await supabase
      .from('resource_guides')
      .insert({ title, youtube_url: url, youtube_id: youtubeId, review_id: reviewId });
    if (err && reviewId) await supabase.from('reviews').delete().eq('id', reviewId);
    setBusy(false);
    if (err) { setGuideError(err.message); return; }
    closeGuideModal();
    fetchGuides();
  }

  function closeGuideModal() {
    setShowGuideModal(false);
    setGuideKind('video');
    setGuideTitle('');
    setGuideUrl('');
    setGuideError(null);
  }

  // A plain guide plays in the modal; a walkthrough opens the Review player
  // full-page (same early return pattern as an open canvas).
  async function openGuide(g) {
    if (!g.review_id) { setPlayingGuide(g); return; }
    if (openingGuideId) return;
    setOpeningGuideId(g.id);
    const { data: review, error: err } = await supabase
      .from('reviews')
      .select('*')
      .eq('id', g.review_id)
      .maybeSingle();
    setOpeningGuideId(null);
    if (err || !review) { alert('Could not open this guide: ' + (err?.message || 'its review is missing.')); return; }
    setOpenWalkthrough({ guide: g, review });
  }

  async function handleDeleteGuide(guide) {
    if (!(await confirm(`Remove the guide "${guide.title}"?`))) return;
    const { error: err } = await supabase.from('resource_guides').delete().eq('id', guide.id);
    if (err) { alert('Failed to delete guide: ' + err.message); return; }
    fetchGuides();
  }

  async function handleCreateCanvas(e) {
    e.preventDefault();
    if (!canvasTitle.trim() || busy) return;
    setBusy(true);
    const { data, error: err } = await supabase
      .from('canvases')
      .insert({ title: canvasTitle.trim(), content: {}, created_by: profile.id })
      .select('id, title')
      .single();
    setBusy(false);
    if (err) { alert('Failed to create canvas: ' + err.message); return; }
    setCanvasTitle('');
    setShowCreateCanvas(false);
    fetchCanvases();
    setOpenCanvas(data);
  }

  async function handleRenameCanvas(id, newName) {
    if (!newName.trim()) { setRenamingId(null); return; }
    const { error: err } = await supabase
      .from('canvases')
      .update({ title: newName.trim(), updated_at: new Date().toISOString() })
      .eq('id', id);
    if (err) { alert('Failed to rename canvas: ' + err.message); return; }
    setRenamingId(null);
    setRenameValue('');
    fetchCanvases();
  }

  async function handleDuplicateCanvas(c) {
    const { data, error: readErr } = await supabase
      .from('canvases').select('content').eq('id', c.id).single();
    if (readErr) { alert('Failed to duplicate canvas: ' + readErr.message); return; }
    const { error: err } = await supabase
      .from('canvases')
      .insert({ title: `${c.title} (copy)`, content: data?.content || {}, created_by: profile.id });
    if (err) { alert('Failed to duplicate canvas: ' + err.message); return; }
    fetchCanvases();
  }

  async function handleDeleteCanvas(c) {
    if (!(await confirm(`Delete the canvas "${c.title}"? This can't be undone.`))) return;
    const { error: err } = await supabase.from('canvases').delete().eq('id', c.id);
    if (err) { alert('Failed to delete canvas: ' + err.message); return; }
    fetchCanvases();
  }

  async function handleCreateFolder(e) {
    e.preventDefault();
    if (!folderName.trim() || busy) return; // busy guard: Enter bypasses the disabled button
    setBusy(true);
    try {
      await callFn('POST', '', {
        action: 'create-folder',
        parentId: currentFolderId,
        name: folderName.trim(),
      });
      setFolderName('');
      setShowCreateFolder(false);
      fetchItems(currentFolderId);
    } catch (err) {
      alert('Failed to create folder: ' + err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateDoc(e) {
    e.preventDefault();
    if (!docTitle.trim() || busy) return; // busy guard: Enter bypasses the disabled button
    setBusy(true);
    try {
      const result = await callFn('POST', '', {
        action: 'create-doc',
        parentId: currentFolderId,
        name: docTitle.trim(),
      });
      setDocTitle('');
      setShowCreateDoc(false);
      fetchItems(currentFolderId);
      if (result.url) window.open(result.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      alert('Failed to create document: ' + err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(item) {
    const label = item.type === 'folder' ? 'folder (and all its contents)' : 'document';
    if (!(await confirm(`Move this ${label} to Drive trash?`))) return;
    try {
      await callFn('POST', '', { action: 'delete', id: item.id });
      fetchItems(currentFolderId);
    } catch (err) {
      alert('Failed to delete: ' + err.message);
    }
  }

  async function handleRename(id, newName) {
    if (!newName.trim()) { setRenamingId(null); return; }
    try {
      await callFn('POST', '', { action: 'rename', id, name: newName.trim() });
      setRenamingId(null);
      setRenameValue('');
      fetchItems(currentFolderId);
    } catch (err) {
      alert('Failed to rename: ' + err.message);
    }
  }

  function openItem(item) {
    if (renamingId === item.id) return;
    if (item.type === 'folder') {
      setPath([...path, { id: item.id, name: item.name }]);
    } else if (item.url) {
      window.open(item.url, '_blank', 'noopener,noreferrer');
    }
  }

  function navigateTo(index) {
    // index = -1 → root, otherwise truncate path to that index inclusive
    if (index < 0) setPath([]);
    else setPath(path.slice(0, index + 1));
  }

  const folders = items.filter(i => i.type === 'folder');
  const docs = items.filter(i => i.type === 'doc');

  if (openWalkthrough) {
    return (
      <ReviewPlayer
        key={openWalkthrough.review.id}
        review={openWalkthrough.review}
        onBack={() => setOpenWalkthrough(null)}
        profile={profile}
        isAdmin={isAdmin}
        mode="guide"
        backLabel="← Back to Resources"
      />
    );
  }

  if (openCanvas) {
    return (
      <CanvasBoard
        canvasId={openCanvas.id}
        title={openCanvas.title}
        onBack={() => { setOpenCanvas(null); fetchCanvases(); }}
      />
    );
  }

  return (
    <div style={styles.page} onClick={() => setContextMenu(null)}>
      <div style={styles.topBar}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={styles.pageTitle}>Resources</h1>
          <div style={styles.breadcrumb}>
            <button onClick={() => navigateTo(-1)} style={styles.crumbBtn}>HOW WE WORK</button>
            {path.map((p, i) => (
              <React.Fragment key={p.id}>
                <span style={styles.crumbSep}>›</span>
                <button onClick={() => navigateTo(i)} style={styles.crumbBtn}>{p.name}</button>
              </React.Fragment>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {isAdmin && (
            <button onClick={() => setShowGuideModal(true)} style={styles.secondaryBtn}>
              + New Guide
            </button>
          )}
          <button onClick={() => { setShowCreateCanvas(!showCreateCanvas); setShowCreateFolder(false); setShowCreateDoc(false); }} style={styles.secondaryBtn}>
            {showCreateCanvas ? '✕ Cancel' : '+ New Canvas'}
          </button>
          <button onClick={() => { setShowCreateFolder(!showCreateFolder); setShowCreateDoc(false); setShowCreateCanvas(false); }} style={styles.secondaryBtn}>
            {showCreateFolder ? '✕ Cancel' : '+ New Folder'}
          </button>
          <button onClick={() => { setShowCreateDoc(!showCreateDoc); setShowCreateFolder(false); setShowCreateCanvas(false); }} style={styles.addBtn}>
            {showCreateDoc ? '✕ Cancel' : '+ New Document'}
          </button>
        </div>
      </div>

      {showCreateCanvas && (
        <form onSubmit={handleCreateCanvas} style={styles.createForm}>
          <input
            autoFocus
            value={canvasTitle}
            onChange={(e) => setCanvasTitle(e.target.value)}
            placeholder="Canvas title..."
            required
            style={styles.input}
          />
          <button type="submit" disabled={busy} style={styles.submitBtn}>
            {busy ? 'Creating...' : 'Create Canvas'}
          </button>
        </form>
      )}

      {showCreateFolder && (
        <form onSubmit={handleCreateFolder} style={styles.createForm}>
          <input
            autoFocus
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            placeholder="Folder name..."
            required
            style={styles.input}
          />
          <button type="submit" disabled={busy} style={styles.submitBtn}>
            {busy ? 'Creating...' : 'Create Folder'}
          </button>
        </form>
      )}

      {showCreateDoc && (
        <form onSubmit={handleCreateDoc} style={styles.createForm}>
          <input
            autoFocus
            value={docTitle}
            onChange={(e) => setDocTitle(e.target.value)}
            placeholder="Document title..."
            required
            style={styles.input}
          />
          <button type="submit" disabled={busy} style={styles.submitBtn}>
            {busy ? 'Creating...' : 'Create Google Doc'}
          </button>
        </form>
      )}

      {error && (
        <div style={styles.errorCard}>
          <p style={styles.errorText}>Error: {error}</p>
        </div>
      )}

      {/* Guides — page-level, so root only, same as Canvases. Empty state shows
          for admin-tier only; there's nothing for everyone else to act on. */}
      {path.length === 0 && (guides.length > 0 || isAdmin) && (
        <div style={{ marginBottom: '28px' }}>
          <h2 style={styles.sectionTitle}>Guides</h2>
          {guides.length === 0 ? (
            <div style={styles.emptyCard}>
              <p style={styles.emptyText}>No guides yet. Add one with “+ New Guide”.</p>
            </div>
          ) : (
            <div style={styles.guideGrid}>
              {guides.map((g) => (
                <div
                  key={g.id}
                  {...clickableKeyProps(() => openGuide(g))}
                  onClick={() => openGuide(g)}
                  onMouseEnter={() => setHoveredGuideId(g.id)}
                  onMouseLeave={() => setHoveredGuideId(null)}
                  style={styles.guideCard}
                  title={g.title}
                >
                  <div style={styles.guideThumbWrap}>
                    <img
                      src={`https://i.ytimg.com/vi/${g.youtube_id}/hqdefault.jpg`}
                      alt=""
                      style={styles.guideThumb}
                      loading="lazy"
                    />
                    {/* Scrim + delete stay out of the way until hover, so a
                        wall of thumbnails reads as artwork, not chrome. */}
                    <span style={{
                      ...styles.guideScrim,
                      opacity: hoveredGuideId === g.id ? 1 : 0,
                    }} />
                    <span style={{
                      ...styles.guidePlayBadge,
                      transform: hoveredGuideId === g.id ? 'scale(1.08)' : 'scale(1)',
                    }}>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                        <path d="M5 3.5v9l7.5-4.5L5 3.5z" />
                      </svg>
                    </span>
                    {g.review_id && (
                      <span style={styles.guideChip} title="Walkthrough — open to leave timestamped notes">
                        <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                          <path d="M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6l-3 3v-3H3a1 1 0 0 1-1-1V3z" />
                        </svg>
                        Walkthrough
                      </span>
                    )}
                    {isAdmin && hoveredGuideId === g.id && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteGuide(g); }}
                        style={styles.guideDeleteBtn}
                        title="Remove guide"
                      >✕</button>
                    )}
                  </div>
                  <div style={styles.guideTitle}>{g.title}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {path.length === 0 && canvases.length > 0 && (
        <ListSection title="Canvases">
          {canvases.map((c) => (
            <ItemRow
              key={c.id}
              item={{ id: c.id, name: c.title, type: 'canvas', owner: c.creator?.full_name, modifiedTime: c.updated_at }}
              icon="🗺️"
              onOpen={() => setOpenCanvas({ id: c.id, title: c.title })}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setContextMenu({ x: e.clientX, y: e.clientY, item: { id: c.id, name: c.title, type: 'canvas', raw: c } });
              }}
              renamingId={renamingId}
              renameValue={renameValue}
              onRenameChange={setRenameValue}
              onRenameCommit={() => handleRenameCanvas(c.id, renameValue)}
              onRenameCancel={() => { setRenamingId(null); setRenameValue(''); }}
              onDelete={() => handleDeleteCanvas(c)}
            />
          ))}
        </ListSection>
      )}

      {loading ? (
        <p style={styles.emptyText}>Loading…</p>
      ) : items.length === 0 ? (
        <div style={styles.emptyCard}>
          <p style={styles.emptyText}>
            {path.length === 0
              ? 'No folders or documents yet. Create a folder or a Google Doc to get started.'
              : 'This folder is empty.'}
          </p>
        </div>
      ) : (
        <>
          {docs.length > 0 && (
            <ListSection title="Documents">
              {docs.map(item => (
                <ItemRow
                  key={item.id}
                  item={item}
                  icon="📝"
                  onOpen={() => openItem(item)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setContextMenu({ x: e.clientX, y: e.clientY, item });
                  }}
                  renamingId={renamingId}
                  renameValue={renameValue}
                  onRenameChange={setRenameValue}
                  onRenameCommit={() => handleRename(item.id, renameValue)}
                  onRenameCancel={() => { setRenamingId(null); setRenameValue(''); }}
                  onDelete={() => handleDelete(item)}
                />
              ))}
            </ListSection>
          )}

          {folders.length > 0 && (
            <ListSection title="Folders">
              {folders.map(item => (
                <ItemRow
                  key={item.id}
                  item={item}
                  icon="📁"
                  onOpen={() => openItem(item)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setContextMenu({ x: e.clientX, y: e.clientY, item });
                  }}
                  renamingId={renamingId}
                  renameValue={renameValue}
                  onRenameChange={setRenameValue}
                  onRenameCommit={() => handleRename(item.id, renameValue)}
                  onRenameCancel={() => { setRenamingId(null); setRenameValue(''); }}
                  onDelete={() => handleDelete(item)}
                />
              ))}
            </ListSection>
          )}
        </>
      )}

      {/* New Guide modal */}
      {showGuideModal && (
        <div style={modalOverlay()} {...backdropDismiss(closeGuideModal)}>
          <form onSubmit={handleCreateGuide} style={styles.guideModal}>
            <h2 style={styles.guideModalTitle}>New Guide</h2>
            <div style={styles.guideKindRow} role="radiogroup" aria-label="Guide type">
              {[
                ['video', 'Video', 'A titled YouTube embed. Watch only.'],
                ['walkthrough', 'Walkthrough', 'Same video, plus timestamped notes anyone on staff can add — the Review player.'],
              ].map(([kind, label, hint]) => (
                <button
                  key={kind}
                  type="button"
                  role="radio"
                  aria-checked={guideKind === kind}
                  onClick={() => setGuideKind(kind)}
                  style={{ ...styles.guideKindBtn, ...(guideKind === kind ? styles.guideKindBtnOn : {}) }}
                >
                  <span style={styles.guideKindLabel}>{label}</span>
                  <span style={styles.guideKindHint}>{hint}</span>
                </button>
              ))}
            </div>
            <label style={styles.guideLabel}>
              Title
              <input
                autoFocus
                value={guideTitle}
                onChange={(e) => { setGuideTitle(e.target.value); setGuideError(null); }}
                placeholder="How we ship a short"
                style={styles.input}
              />
            </label>
            <label style={styles.guideLabel}>
              YouTube link
              <input
                value={guideUrl}
                onChange={(e) => { setGuideUrl(e.target.value); setGuideError(null); }}
                placeholder="https://www.youtube.com/watch?v=..."
                style={styles.input}
              />
            </label>
            {/* Preview doubles as validation feedback — if the thumbnail
                resolves, the link parsed. */}
            {parseYouTubeId(guideUrl) && (
              <img
                src={`https://i.ytimg.com/vi/${parseYouTubeId(guideUrl)}/mqdefault.jpg`}
                alt=""
                style={styles.guidePreview}
              />
            )}
            {guideError && <p style={styles.errorText}>{guideError}</p>}
            <div style={styles.guideModalActions}>
              <button type="button" onClick={closeGuideModal} style={styles.secondaryBtn}>Cancel</button>
              <button
                type="submit"
                disabled={busy || !guideTitle.trim() || !parseYouTubeId(guideUrl)}
                style={{
                  ...styles.submitBtn,
                  alignSelf: 'auto',
                  opacity: (busy || !guideTitle.trim() || !parseYouTubeId(guideUrl)) ? 0.45 : 1,
                }}
              >
                {busy ? 'Saving…' : (guideKind === 'walkthrough' ? 'Save Walkthrough' : 'Save Guide')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Player modal */}
      {playingGuide && (
        <div style={modalOverlay()} {...backdropDismiss(() => setPlayingGuide(null))}>
          <div style={styles.playerModal}>
            <div style={styles.playerHeader}>
              <span style={styles.playerTitle}>{playingGuide.title}</span>
              <button onClick={() => setPlayingGuide(null)} style={styles.playerCloseBtn} aria-label="Close video">✕</button>
            </div>
            <div style={styles.playerFrameWrap}>
              <iframe
                key={playingGuide.id}
                src={`https://www.youtube-nocookie.com/embed/${playingGuide.youtube_id}?autoplay=1&rel=0`}
                title={playingGuide.title}
                style={styles.playerFrame}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                allowFullScreen
              />
            </div>
          </div>
        </div>
      )}

      {contextMenu && (
        <>
          <div style={styles.contextOverlay} onClick={() => setContextMenu(null)} onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }} />
          <div style={{ ...styles.contextMenu, top: contextMenu.y, left: contextMenu.x }}>
            <button
              style={styles.contextMenuItem}
              onClick={() => {
                setRenamingId(contextMenu.item.id);
                setRenameValue(contextMenu.item.name);
                setContextMenu(null);
              }}
            >
              Rename
            </button>
            {contextMenu.item.type === 'canvas' && (
              <button
                style={styles.contextMenuItem}
                onClick={() => {
                  handleDuplicateCanvas(contextMenu.item.raw);
                  setContextMenu(null);
                }}
              >
                Duplicate
              </button>
            )}
            {contextMenu.item.type === 'doc' && contextMenu.item.url && (
              <button
                style={styles.contextMenuItem}
                onClick={() => {
                  window.open(contextMenu.item.url, '_blank', 'noopener,noreferrer');
                  setContextMenu(null);
                }}
              >
                Open in Drive
              </button>
            )}
            <button
              style={{ ...styles.contextMenuItem, color: '#ef4444' }}
              onClick={() => {
                if (contextMenu.item.type === 'canvas') handleDeleteCanvas(contextMenu.item.raw);
                else handleDelete(contextMenu.item);
                setContextMenu(null);
              }}
            >
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ListSection({ title, children }) {
  return (
    <div style={{ marginBottom: '28px' }}>
      <h2 style={styles.sectionTitle}>{title}</h2>
      <div style={styles.listCard}>
        <div style={styles.listHeader}>
          <div>Name</div>
          <div>Owner</div>
          <div>Modified</div>
          <div />
        </div>
        {children}
      </div>
    </div>
  );
}

function ItemRow({ item, icon, onOpen, onContextMenu, renamingId, renameValue, onRenameChange, onRenameCommit, onRenameCancel, onDelete }) {
  const isRenaming = renamingId === item.id;
  return (
    <div {...clickableKeyProps(onOpen)} style={styles.listRow} onClick={onOpen} onContextMenu={onContextMenu}>
      <div style={styles.rowName}>
        <span style={styles.rowIcon}>{icon}</span>
        {isRenaming ? (
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRenameCommit();
              if (e.key === 'Escape') onRenameCancel();
            }}
            onBlur={onRenameCommit}
            onClick={(e) => e.stopPropagation()}
            style={styles.renameInput}
          />
        ) : (
          <span style={styles.rowTitle}>{item.name}</span>
        )}
      </div>
      <div style={styles.rowMeta}>{item.owner || ''}</div>
      <div style={styles.rowMeta}>
        {item.modifiedTime ? new Date(item.modifiedTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
      </div>
      <div>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          style={styles.rowActionBtn}
          title="Delete"
        >✕</button>
      </div>
    </div>
  );
}

const styles = {
  page: { padding: '32px 40px', minHeight: '100vh' },
  topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px', gap: '16px' },
  pageTitle: { fontSize: '28px', fontWeight: 700, color: '#ffffff', margin: '0 0 4px 0', letterSpacing: '-0.5px' },
  breadcrumb: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', fontSize: '13px' },
  crumbBtn: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.55)', fontSize: '13px', cursor: 'pointer', padding: 0, fontFamily: 'inherit', fontWeight: 500 },
  crumbSep: { color: 'rgba(255,255,255,0.25)', fontSize: '13px' },
  addBtn: { padding: '10px 20px', background: 'linear-gradient(135deg, #5b8fc7, #8fb4d8)', border: 'none', borderRadius: '10px', color: colors.white, fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  secondaryBtn: { padding: '10px 20px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: '#e2e8f0', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  createForm: { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '14px', padding: '20px', marginBottom: '24px', display: 'flex', flexDirection: 'column', gap: '12px' },
  input: { padding: '10px 14px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '14px', fontFamily: 'inherit', outline: 'none' },
  submitBtn: { padding: '10px 20px', background: colors.accent, border: 'none', borderRadius: '8px', color: colors.white, fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', alignSelf: 'flex-start' },
  sectionTitle: { fontSize: '13px', fontWeight: 700, color: 'rgba(255,255,255,0.55)', margin: '0 0 12px 0', textTransform: 'uppercase', letterSpacing: '0.5px' },
  listCard: { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', overflow: 'hidden' },
  listHeader: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 200px 110px 36px', alignItems: 'center', gap: '12px', padding: '10px 16px', fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid rgba(255,255,255,0.06)' },
  listRow: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 200px 110px 36px', alignItems: 'center', gap: '12px', padding: '10px 16px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.04)' },
  rowName: { display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 },
  rowIcon: { fontSize: '16px', flexShrink: 0 },
  rowTitle: { fontSize: '14px', fontWeight: 600, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  rowMeta: { fontSize: '12px', color: 'rgba(255,255,255,0.35)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  rowActionBtn: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.2)', cursor: 'pointer', fontSize: '13px', padding: '4px' },
  emptyCard: { background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '14px', padding: '40px', textAlign: 'center' },
  emptyText: { color: 'rgba(255,255,255,0.35)', fontSize: '14px', margin: 0 },
  errorCard: { background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '12px', padding: '14px 18px', marginBottom: '20px' },
  errorText: { color: '#fca5a5', fontSize: '13px', margin: 0 },
  contextOverlay: { position: 'fixed', inset: 0, zIndex: 999 },
  contextMenu: { position: 'fixed', zIndex: 1000, background: colors.bgHover, border: '1px solid rgba(255,255,255,0.12)', borderRadius: '10px', padding: '4px', minWidth: '180px', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' },
  contextMenuItem: { display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 12px', background: 'none', border: 'none', borderRadius: '6px', color: '#e2e8f0', fontSize: '13px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' },
  // ── Guides ──
  guideGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '16px' },
  guideCard: { cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '8px' },
  guideThumbWrap: {
    position: 'relative', borderRadius: '12px', overflow: 'hidden',
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
    aspectRatio: '16 / 9',
  },
  guideThumb: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  guideScrim: {
    position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)',
    transition: 'opacity 0.12s', pointerEvents: 'none',
  },
  guidePlayBadge: {
    position: 'absolute', top: '50%', left: '50%', marginTop: '-20px', marginLeft: '-20px',
    width: '40px', height: '40px', borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(0,0,0,0.55)', border: '1px solid rgba(255,255,255,0.35)',
    color: '#ffffff', transition: 'transform 0.12s', pointerEvents: 'none',
  },
  guideDeleteBtn: {
    position: 'absolute', top: '6px', right: '6px', width: '24px', height: '24px',
    borderRadius: '7px', border: 'none', background: 'rgba(0,0,0,0.55)',
    color: 'rgba(255,255,255,0.8)', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit',
  },
  guideTitle: { fontSize: '14px', fontWeight: 600, color: '#e2e8f0', lineHeight: 1.35 },
  guideChip: {
    position: 'absolute', top: '6px', left: '6px',
    display: 'inline-flex', alignItems: 'center', gap: '4px',
    padding: '3px 7px', borderRadius: '6px',
    background: 'rgba(15,15,26,0.78)', border: '1px solid rgba(99,102,241,0.55)',
    color: '#c7d2fe', fontSize: '10px', fontWeight: 700, letterSpacing: '0.02em',
    pointerEvents: 'none',
  },
  guideKindRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' },
  guideKindBtn: {
    display: 'flex', flexDirection: 'column', gap: '4px', textAlign: 'left',
    padding: '10px 12px', borderRadius: '10px', cursor: 'pointer', fontFamily: 'inherit',
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
  },
  guideKindBtnOn: { background: 'rgba(99,102,241,0.14)', border: '1px solid rgba(99,102,241,0.7)' },
  guideKindLabel: { fontSize: '13px', fontWeight: 700, color: '#ffffff' },
  guideKindHint: { fontSize: '11px', lineHeight: 1.4, color: 'rgba(255,255,255,0.5)' },
  guideModal: {
    ...modalShell({ width: 460 }),
    display: 'flex', flexDirection: 'column', gap: '14px',
    fontFamily: 'inherit',
  },
  guideModalTitle: { fontSize: '18px', fontWeight: 700, color: '#ffffff', margin: 0 },
  guideLabel: {
    display: 'flex', flexDirection: 'column', gap: '6px',
    fontSize: '12px', fontWeight: 600, color: 'rgba(255,255,255,0.55)',
  },
  guidePreview: { width: '100%', borderRadius: '10px', display: 'block' },
  guideModalActions: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '2px' },
  playerModal: {
    ...modalShell({ width: 900 }),
    padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column',
  },
  playerHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
    padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  playerTitle: { fontSize: '15px', fontWeight: 600, color: '#ffffff', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  playerCloseBtn: {
    background: 'rgba(255,255,255,0.06)', border: 'none', color: 'rgba(255,255,255,0.6)',
    width: '30px', height: '30px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', flexShrink: 0,
  },
  playerFrameWrap: { width: '100%', aspectRatio: '16 / 9', background: '#000' },
  playerFrame: { width: '100%', height: '100%', border: 'none', display: 'block' },
  renameInput: { width: '100%', padding: '4px 8px', background: colors.border, border: '1px solid rgba(91, 143, 199,0.5)', borderRadius: '6px', color: colors.white, fontSize: '14px', fontWeight: 600, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' },
};
