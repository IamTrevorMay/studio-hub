import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { useConfirm } from '../contexts/ConfirmContext';
import useVisibilityRefresh from '../hooks/useVisibilityRefresh';
import CanvasBoard from './editors/CanvasBoard';

const FN_URL = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/google-drive-resources`;

export default function Resources() {
  const { profile } = useAuth();
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
    <div style={styles.listRow} onClick={onOpen} onContextMenu={onContextMenu}>
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
  addBtn: { padding: '10px 20px', background: 'linear-gradient(135deg, #6366f1, #818cf8)', border: 'none', borderRadius: '10px', color: '#fff', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  secondaryBtn: { padding: '10px 20px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: '#e2e8f0', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  createForm: { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '14px', padding: '20px', marginBottom: '24px', display: 'flex', flexDirection: 'column', gap: '12px' },
  input: { padding: '10px 14px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '14px', fontFamily: 'inherit', outline: 'none' },
  submitBtn: { padding: '10px 20px', background: '#6366f1', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', alignSelf: 'flex-start' },
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
  contextMenu: { position: 'fixed', zIndex: 1000, background: '#1e1e32', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '10px', padding: '4px', minWidth: '180px', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' },
  contextMenuItem: { display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 12px', background: 'none', border: 'none', borderRadius: '6px', color: '#e2e8f0', fontSize: '13px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' },
  renameInput: { width: '100%', padding: '4px 8px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(99,102,241,0.5)', borderRadius: '6px', color: '#fff', fontSize: '14px', fontWeight: 600, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' },
};
