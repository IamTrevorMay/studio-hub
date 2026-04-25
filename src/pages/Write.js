import React, { useState, useEffect, useCallback } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { supabase } from '../supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import useVisibilityRefresh from '../hooks/useVisibilityRefresh';

const FN_URL = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/google-drive-write`;

export default function Write() {
  const { profile } = useAuth();
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

  const fetchItems = useCallback(async (folderId) => {
    setLoading(true);
    setError(null);
    try {
      const query = folderId ? `folderId=${encodeURIComponent(folderId)}` : '';
      const data = await callFn('GET', query);
      setItems(data.items || []);
      if (!rootId && data.rootId) setRootId(data.rootId);
    } catch (err) {
      console.error('Error fetching Drive items:', err);
      setError(err.message);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [callFn, rootId]);

  useEffect(() => {
    if (!profile?.id) return;
    fetchItems(currentFolderId || null);
  }, [profile?.id, currentFolderId, fetchItems]);

  useVisibilityRefresh(() => fetchItems(currentFolderId || null));

  async function handleCreateFolder(e) {
    e.preventDefault();
    if (!folderName.trim()) return;
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
    if (!docTitle.trim()) return;
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
    if (!window.confirm(`Move this ${label} to Drive trash?`)) return;
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

  return (
    <div style={styles.page} onClick={() => setContextMenu(null)}>
      <div style={styles.topBar}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={styles.pageTitle}>Write</h1>
          <div style={styles.breadcrumb}>
            <button onClick={() => navigateTo(-1)} style={styles.crumbBtn}>Write</button>
            {path.map((p, i) => (
              <React.Fragment key={p.id}>
                <span style={styles.crumbSep}>›</span>
                <button onClick={() => navigateTo(i)} style={styles.crumbBtn}>{p.name}</button>
              </React.Fragment>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => { setShowCreateFolder(!showCreateFolder); setShowCreateDoc(false); }} style={styles.secondaryBtn}>
            {showCreateFolder ? '✕ Cancel' : '+ New Folder'}
          </button>
          <button onClick={() => { setShowCreateDoc(!showCreateDoc); setShowCreateFolder(false); }} style={styles.addBtn}>
            {showCreateDoc ? '✕ Cancel' : '+ New Document'}
          </button>
        </div>
      </div>

      <div style={styles.twoColumnLayout}>
        <div style={styles.mainColumn}>
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
              {folders.length > 0 && (
                <div style={{ marginBottom: '28px' }}>
                  <h2 style={styles.sectionTitle}>Folders</h2>
                  <div style={styles.folderGrid}>
                    {folders.map(item => (
                      <ItemCard
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
                  </div>
                </div>
              )}

              {docs.length > 0 && (
                <div>
                  <h2 style={styles.sectionTitle}>Documents</h2>
                  <div style={styles.docGrid}>
                    {docs.map(item => (
                      <ItemCard
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
                        compact
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <aside style={styles.sideColumn}>
          <IdeasSection />
        </aside>
      </div>

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
              ✏️ Rename
            </button>
            {contextMenu.item.type === 'doc' && contextMenu.item.url && (
              <button
                style={styles.contextMenuItem}
                onClick={() => {
                  window.open(contextMenu.item.url, '_blank', 'noopener,noreferrer');
                  setContextMenu(null);
                }}
              >
                🔗 Open in Drive
              </button>
            )}
            <button
              style={{ ...styles.contextMenuItem, color: '#ef4444' }}
              onClick={() => {
                handleDelete(contextMenu.item);
                setContextMenu(null);
              }}
            >
              🗑 Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// IdeasSection — shared, fully-interactive idea list. Modeled after the
// Dashboard To Do widget, but every authenticated user sees and edits the
// same rows. No "delete checked on refresh" because it's shared.
// ────────────────────────────────────────────────────────────────────────────
function IdeasSection() {
  const { profile } = useAuth();
  const [ideas, setIdeas] = useState([]);
  const [collapsed, setCollapsed] = useState(false);
  const [showInput, setShowInput] = useState(false);
  const [newIdeaText, setNewIdeaText] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editingText, setEditingText] = useState('');

  const fetchIdeas = useCallback(async () => {
    const { data, error } = await supabase
      .from('write_ideas')
      .select('*')
      .order('position', { ascending: true });
    if (error) { console.error('Error loading ideas:', error); return; }
    setIdeas(data || []);
  }, []);

  useEffect(() => { fetchIdeas(); }, [fetchIdeas]);
  useVisibilityRefresh(fetchIdeas);

  async function addIdea() {
    const text = newIdeaText.trim();
    if (!text) return;
    if (!profile?.id) { alert('Cannot add idea: not signed in.'); return; }
    const nextPosition = ideas.length > 0
      ? Math.max(...ideas.map(i => i.position || 0)) + 1
      : 0;
    const { data, error } = await supabase
      .from('write_ideas')
      .insert({ text, checked: false, position: nextPosition, created_by: profile.id })
      .select()
      .single();
    if (error) {
      console.error('Error adding idea:', error);
      alert(`Could not save idea: ${error.message || 'unknown error'}`);
      return;
    }
    setIdeas(prev => [...prev, data]);
    setNewIdeaText('');
    setShowInput(false);
  }

  async function toggleIdea(id) {
    const current = ideas.find(i => i.id === id);
    if (!current) return;
    const nextChecked = !current.checked;
    setIdeas(prev => prev.map(i => i.id === id ? { ...i, checked: nextChecked } : i));
    const { error } = await supabase
      .from('write_ideas')
      .update({ checked: nextChecked, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      console.error('Error toggling idea:', error);
      setIdeas(prev => prev.map(i => i.id === id ? { ...i, checked: current.checked } : i));
    }
  }

  async function deleteIdea(id) {
    const previous = ideas;
    setIdeas(prev => prev.filter(i => i.id !== id));
    const { error } = await supabase.from('write_ideas').delete().eq('id', id);
    if (error) {
      console.error('Error deleting idea:', error);
      setIdeas(previous);
    }
  }

  async function saveEdit(id) {
    const trimmed = editingText.trim();
    setEditingId(null);
    setEditingText('');
    if (!trimmed) return;
    const current = ideas.find(i => i.id === id);
    if (!current || current.text === trimmed) return;
    setIdeas(prev => prev.map(i => i.id === id ? { ...i, text: trimmed } : i));
    const { error } = await supabase
      .from('write_ideas')
      .update({ text: trimmed, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      console.error('Error saving idea edit:', error);
      setIdeas(prev => prev.map(i => i.id === id ? { ...i, text: current.text } : i));
    }
  }

  async function handleDragEnd(result) {
    if (!result.destination) return;
    const items = Array.from(ideas);
    const [moved] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, moved);
    const reindexed = items.map((item, idx) => ({ ...item, position: idx }));
    setIdeas(reindexed);
    const updates = reindexed.map(item =>
      supabase.from('write_ideas').update({ position: item.position }).eq('id', item.id)
    );
    const results = await Promise.all(updates);
    const firstError = results.find(r => r.error)?.error;
    if (firstError) console.error('Error reordering ideas:', firstError);
  }

  return (
    <div style={ideaStyles.section}>
      <div style={ideaStyles.headerRow}>
        <button
          onClick={() => setCollapsed(prev => !prev)}
          style={ideaStyles.headerBtn}
        >
          <span style={ideaStyles.headerLabel}>Ideas</span>
          <span style={ideaStyles.headerCount}>{ideas.length}</span>
          <span style={ideaStyles.headerChevron}>{collapsed ? '▶' : '▼'}</span>
        </button>
        {!collapsed && !showInput && (
          <button onClick={() => setShowInput(true)} style={ideaStyles.addBtn}>+ Add</button>
        )}
      </div>

      {!collapsed && (
        <>
          {showInput && (
            <div style={ideaStyles.addRow}>
              <input
                value={newIdeaText}
                onChange={(e) => setNewIdeaText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addIdea();
                  if (e.key === 'Escape') { setShowInput(false); setNewIdeaText(''); }
                }}
                placeholder="Add an idea..."
                style={ideaStyles.input}
                autoFocus
              />
              <button
                onClick={addIdea}
                disabled={!newIdeaText.trim()}
                style={{ ...ideaStyles.submitBtn, opacity: newIdeaText.trim() ? 1 : 0.4 }}
              >
                Add
              </button>
              <button
                onClick={() => { setShowInput(false); setNewIdeaText(''); }}
                style={ideaStyles.cancelBtn}
              >
                Cancel
              </button>
            </div>
          )}

          <DragDropContext onDragEnd={handleDragEnd}>
            <Droppable droppableId="ideas-list">
              {(provided) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  style={{ ...ideaStyles.list, marginTop: showInput ? '8px' : '0' }}
                >
                  {ideas.map((item, index) => (
                    <Draggable key={item.id} draggableId={item.id} index={index}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          style={{
                            ...ideaStyles.itemWrap,
                            ...(snapshot.isDragging ? { boxShadow: '0 4px 16px rgba(0,0,0,0.3)', opacity: 0.95 } : {}),
                            ...provided.draggableProps.style,
                          }}
                        >
                          <div style={ideaStyles.item}>
                            <div {...provided.dragHandleProps} style={ideaStyles.dragHandle}>⠿</div>
                            <input
                              type="checkbox"
                              checked={item.checked}
                              onChange={() => toggleIdea(item.id)}
                              style={ideaStyles.checkbox}
                            />
                            {editingId === item.id ? (
                              <input
                                value={editingText}
                                onChange={(e) => setEditingText(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') saveEdit(item.id);
                                  if (e.key === 'Escape') { setEditingId(null); setEditingText(''); }
                                }}
                                onBlur={() => saveEdit(item.id)}
                                style={ideaStyles.editInput}
                                autoFocus
                              />
                            ) : (
                              <span
                                style={{
                                  ...ideaStyles.itemText,
                                  textDecoration: item.checked ? 'line-through' : 'none',
                                  opacity: item.checked ? 0.45 : 1,
                                }}
                                onDoubleClick={() => { setEditingId(item.id); setEditingText(item.text); }}
                                title="Double-click to edit"
                              >
                                {item.text}
                              </span>
                            )}
                            <button
                              onClick={() => deleteIdea(item.id)}
                              style={ideaStyles.deleteBtn}
                              title="Delete"
                            >✕</button>
                          </div>
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                  {ideas.length === 0 && !showInput && (
                    <p style={ideaStyles.emptyText}>No ideas yet</p>
                  )}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        </>
      )}
    </div>
  );
}

const ideaStyles = {
  section: { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '14px', padding: '16px 20px', marginBottom: '24px' },
  headerRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' },
  headerBtn: { display: 'flex', alignItems: 'center', gap: '8px', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit' },
  headerLabel: { fontSize: '13px', fontWeight: 700, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.5px' },
  headerCount: { fontSize: '11px', color: 'rgba(255,255,255,0.3)', fontWeight: 600 },
  headerChevron: { fontSize: '10px', color: 'rgba(255,255,255,0.35)' },
  addBtn: { padding: '4px 10px', background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: '6px', color: '#a5b4fc', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  addRow: { display: 'flex', gap: '8px', marginTop: '12px' },
  input: { flex: 1, padding: '8px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff', fontSize: '13px', fontFamily: 'inherit', outline: 'none' },
  submitBtn: { padding: '8px 14px', background: '#6366f1', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  cancelBtn: { padding: '8px 14px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: 'rgba(255,255,255,0.6)', fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit' },
  list: { display: 'flex', flexDirection: 'column', gap: '4px' },
  itemWrap: { borderRadius: '6px' },
  item: { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 4px' },
  dragHandle: { color: 'rgba(255,255,255,0.2)', fontSize: '14px', cursor: 'grab', userSelect: 'none', lineHeight: 1, paddingRight: '2px' },
  checkbox: { width: '14px', height: '14px', cursor: 'pointer' },
  itemText: { flex: 1, fontSize: '13px', color: '#e2e8f0', cursor: 'text', wordBreak: 'break-word' },
  editInput: { flex: 1, padding: '4px 8px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(99,102,241,0.5)', borderRadius: '6px', color: '#fff', fontSize: '13px', fontFamily: 'inherit', outline: 'none' },
  deleteBtn: { background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '12px', padding: '4px', opacity: 0.6 },
  emptyText: { color: 'rgba(255,255,255,0.35)', fontSize: '13px', margin: '8px 0 0 0' },
};

function ItemCard({ item, icon, onOpen, onContextMenu, renamingId, renameValue, onRenameChange, onRenameCommit, onRenameCancel, onDelete, compact }) {
  const isRenaming = renamingId === item.id;
  return (
    <div
      style={compact ? styles.docCard : styles.folderCard}
      onClick={onOpen}
      onContextMenu={onContextMenu}
    >
      <div style={compact ? styles.docCardIcon : { fontSize: '28px', marginBottom: '8px' }}>{icon}</div>
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
        <div style={compact ? styles.docCardTitle : styles.folderCardName}>{item.name}</div>
      )}
      <div style={styles.docCardMeta}>
        {item.owner ? `${item.owner} · ` : ''}
        {item.modifiedTime ? new Date(item.modifiedTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
      </div>
      <div style={styles.docCardActions}>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          style={styles.docActionBtn}
          title="Delete"
        >✕</button>
      </div>
    </div>
  );
}

const styles = {
  page: { padding: '32px 40px', minHeight: '100vh' },
  twoColumnLayout: { display: 'flex', gap: '24px', alignItems: 'flex-start' },
  mainColumn: { flex: 3, minWidth: 0 },
  sideColumn: { flex: 1, minWidth: '240px', position: 'sticky', top: '32px' },
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
  folderGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '14px' },
  folderCard: { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '18px', cursor: 'pointer', transition: 'border-color 0.15s', position: 'relative' },
  folderCardName: { fontSize: '15px', fontWeight: 600, color: '#ffffff', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  docGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' },
  docCard: { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '16px', cursor: 'pointer', transition: 'border-color 0.15s', position: 'relative' },
  docCardIcon: { fontSize: '24px', marginBottom: '8px' },
  docCardTitle: { fontSize: '14px', fontWeight: 600, color: '#e2e8f0', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  docCardMeta: { fontSize: '11px', color: 'rgba(255,255,255,0.3)' },
  docCardActions: { position: 'absolute', top: '8px', right: '8px', display: 'flex', gap: '2px' },
  docActionBtn: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.2)', cursor: 'pointer', fontSize: '13px', padding: '4px' },
  emptyCard: { background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '14px', padding: '40px', textAlign: 'center' },
  emptyText: { color: 'rgba(255,255,255,0.35)', fontSize: '14px', margin: 0 },
  errorCard: { background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '12px', padding: '14px 18px', marginBottom: '20px' },
  errorText: { color: '#fca5a5', fontSize: '13px', margin: 0 },
  contextOverlay: { position: 'fixed', inset: 0, zIndex: 999 },
  contextMenu: { position: 'fixed', zIndex: 1000, background: '#1e1e32', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '10px', padding: '4px', minWidth: '180px', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' },
  contextMenuItem: { display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 12px', background: 'none', border: 'none', borderRadius: '6px', color: '#e2e8f0', fontSize: '13px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' },
  renameInput: { width: '100%', padding: '4px 8px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(99,102,241,0.5)', borderRadius: '6px', color: '#fff', fontSize: '14px', fontWeight: 600, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', marginBottom: '4px' },
};
