import React, { useState, useEffect, useRef } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';

/**
 * SidebarEditMode — Admin DnD editor for sidebar navigation.
 * Single flat Droppable with folder membership determined by position.
 * Collapsed folders break the auto-assign chain — items after a collapsed
 * folder land at root level, not inside the folder.
 */
export default function SidebarEditMode({ resolvedNav, navIconMap, onSave, onReset, onCancel, saving }) {
  const [items, setItems] = useState([]);
  // children of collapsed folders are removed from the DnD list and stored here
  const [collapsedChildren, setCollapsedChildren] = useState({});
  const [editingLabel, setEditingLabel] = useState(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    setItems(resolvedNav.map(entry => ({ ...entry })));
    setCollapsedChildren({});
  }, [resolvedNav]);

  useEffect(() => {
    if (editingLabel && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingLabel]);

  function onDragEnd(result) {
    if (!result.destination) return;
    const newItems = Array.from(items);
    const [moved] = newItems.splice(result.source.index, 1);
    newItems.splice(result.destination.index, 0, moved);
    setItems(recalcFolders(newItems));
  }

  // Collapsed folders set currentFolderId to null so subsequent items land at root level.
  function recalcFolders(list) {
    let currentFolderId = null;
    return list.map(entry => {
      if (entry.type === 'folder') {
        currentFolderId = entry.collapsed ? null : entry.id;
        return { ...entry };
      }
      return { ...entry, folderId: currentFolderId };
    });
  }

  function toggleFolderCollapse(folderId) {
    const folder = items.find(f => f.type === 'folder' && f.id === folderId);
    if (!folder) return;

    if (!folder.collapsed) {
      // Collapse: pull children out of the DnD list
      const children = items.filter(e => e.folderId === folderId);
      setCollapsedChildren(prev => ({ ...prev, [folderId]: children }));
      setItems(prev =>
        prev
          .map(e => e.type === 'folder' && e.id === folderId ? { ...e, collapsed: true } : e)
          .filter(e => e.folderId !== folderId)
      );
    } else {
      // Expand: re-insert children right after the folder
      const children = collapsedChildren[folderId] || [];
      setCollapsedChildren(prev => {
        const next = { ...prev };
        delete next[folderId];
        return next;
      });
      setItems(prev => {
        const idx = prev.findIndex(e => e.type === 'folder' && e.id === folderId);
        const result = [...prev];
        result[idx] = { ...result[idx], collapsed: false };
        result.splice(idx + 1, 0, ...children);
        return recalcFolders(result);
      });
    }
  }

  function startEdit(id, currentLabel) {
    setEditingLabel(id);
    setEditValue(currentLabel);
  }

  function confirmEdit(id) {
    const trimmed = editValue.trim();
    if (trimmed) {
      setItems(prev => prev.map(entry => {
        const entryId = entry.type === 'folder' ? entry.id : entry.key;
        if (entryId === id) return { ...entry, label: trimmed };
        return entry;
      }));
    }
    setEditingLabel(null);
  }

  function addFolder() {
    const id = 'folder-' + Date.now().toString(36);
    setItems(prev => [...prev, { type: 'folder', id, label: 'New Folder', collapsed: false }]);
  }

  function deleteFolder(folderId) {
    // Also release any collapsed children back to root level
    const orphans = (collapsedChildren[folderId] || []).map(e => ({ ...e, folderId: null }));
    setCollapsedChildren(prev => { const next = { ...prev }; delete next[folderId]; return next; });
    setItems(prev => {
      const without = prev
        .filter(e => !(e.type === 'folder' && e.id === folderId))
        .map(e => e.folderId === folderId ? { ...e, folderId: null } : e);
      // Insert orphans after the folder's former position (append at end for simplicity)
      return [...without, ...orphans];
    });
  }

  function handleSave() {
    // Merge collapsed children back in before saving
    let allItems = [...items];
    Object.entries(collapsedChildren).forEach(([folderId, children]) => {
      const folderIdx = allItems.findIndex(e => e.type === 'folder' && e.id === folderId);
      if (folderIdx !== -1) allItems.splice(folderIdx + 1, 0, ...children);
    });

    const configItems = allItems.map(entry => {
      if (entry.type === 'folder') {
        return { type: 'folder', id: entry.id, label: entry.label, collapsed: false };
      }
      return { type: 'item', key: entry.key, label: entry.label, folderId: entry.folderId || null };
    });
    onSave(configItems);
  }

  function getEntryId(entry) {
    return entry.type === 'folder' ? entry.id : entry.key;
  }

  return (
    <div style={editStyles.container}>
      <div style={editStyles.header}>
        <span style={editStyles.headerTitle}>Edit Navigation</span>
      </div>

      <DragDropContext onDragEnd={onDragEnd}>
        <Droppable droppableId="nav-edit">
          {(provided) => (
            <div ref={provided.innerRef} {...provided.droppableProps} style={editStyles.list}>
              {items.map((entry, index) => {
                const id = getEntryId(entry);
                const isFolder = entry.type === 'folder';
                const Icon = !isFolder ? navIconMap[entry.key] : null;
                const isChild = !isFolder && entry.folderId;
                const childCount = isFolder
                  ? (entry.collapsed
                      ? (collapsedChildren[entry.id] || []).length
                      : items.filter(e => e.folderId === entry.id).length)
                  : 0;

                return (
                  <Draggable key={id} draggableId={id} index={index}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.draggableProps}
                        style={{
                          ...editStyles.row,
                          ...(isFolder ? editStyles.folderRow : {}),
                          ...(isChild ? { paddingLeft: '32px' } : {}),
                          ...(snapshot.isDragging ? editStyles.dragging : {}),
                          ...provided.draggableProps.style,
                        }}
                      >
                        {/* Drag handle */}
                        <span {...provided.dragHandleProps} style={editStyles.handle}>
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                            <circle cx="4" cy="2" r="1" /><circle cx="8" cy="2" r="1" />
                            <circle cx="4" cy="6" r="1" /><circle cx="8" cy="6" r="1" />
                            <circle cx="4" cy="10" r="1" /><circle cx="8" cy="10" r="1" />
                          </svg>
                        </span>

                        {/* Collapse toggle for folders */}
                        {isFolder && (
                          <button
                            onClick={() => toggleFolderCollapse(entry.id)}
                            style={editStyles.collapseBtn}
                            title={entry.collapsed ? 'Expand folder' : 'Collapse folder'}
                          >
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"
                              style={{ transform: entry.collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.15s' }}>
                              <path d="M2 3l3 4 3-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </button>
                        )}

                        {/* Icon for items */}
                        {Icon && <Icon active={false} />}

                        {/* Folder icon */}
                        {isFolder && !entry.collapsed && (
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.2">
                            <path d="M2 4h4l1.5 1.5H14v8H2V4z" />
                          </svg>
                        )}
                        {isFolder && entry.collapsed && (
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="rgba(255,255,255,0.2)" stroke="rgba(255,255,255,0.4)" strokeWidth="1.2">
                            <path d="M2 4h4l1.5 1.5H14v8H2V4z" />
                          </svg>
                        )}

                        {/* Label */}
                        {editingLabel === id ? (
                          <input
                            ref={inputRef}
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={() => confirmEdit(id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') confirmEdit(id);
                              if (e.key === 'Escape') setEditingLabel(null);
                            }}
                            style={editStyles.input}
                          />
                        ) : (
                          <span
                            onClick={() => startEdit(id, entry.label)}
                            style={editStyles.label}
                            title="Click to rename"
                          >
                            {entry.label}
                            {isFolder && entry.collapsed && childCount > 0 && (
                              <span style={{ marginLeft: '4px', fontSize: '10px', color: 'rgba(255,255,255,0.3)' }}>
                                ({childCount})
                              </span>
                            )}
                          </span>
                        )}

                        {/* Delete folder button */}
                        {isFolder && (
                          <button
                            onClick={() => deleteFolder(entry.id)}
                            style={editStyles.deleteBtn}
                            title="Delete folder (items become top-level)"
                          >
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                              <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" fill="none" />
                            </svg>
                          </button>
                        )}
                      </div>
                    )}
                  </Draggable>
                );
              })}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>

      {/* Actions */}
      <div style={editStyles.actions}>
        <button onClick={addFolder} style={editStyles.addFolderBtn}>
          + Folder
        </button>
        <button onClick={onReset} style={editStyles.resetBtn}>
          Reset
        </button>
      </div>

      <div style={editStyles.footer}>
        <button onClick={onCancel} style={editStyles.cancelBtn}>Cancel</button>
        <button onClick={handleSave} disabled={saving} style={editStyles.saveBtn}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
}

const editStyles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    width: '100%',
  },
  header: {
    padding: '4px 4px 8px',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    marginBottom: '4px',
  },
  headerTitle: {
    fontSize: '11px',
    fontWeight: 700,
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1px',
    maxHeight: 'calc(100vh - 340px)',
    overflowY: 'auto',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 8px',
    borderRadius: '8px',
    background: 'transparent',
    minHeight: '34px',
  },
  folderRow: {
    background: 'rgba(255,255,255,0.03)',
    borderLeft: '2px solid rgba(99,102,241,0.4)',
  },
  dragging: {
    background: 'rgba(99,102,241,0.15)',
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
  },
  handle: {
    display: 'flex',
    alignItems: 'center',
    cursor: 'grab',
    color: 'rgba(255,255,255,0.25)',
    flexShrink: 0,
    padding: '2px',
  },
  collapseBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '18px',
    height: '18px',
    border: 'none',
    borderRadius: '4px',
    background: 'transparent',
    color: 'rgba(255,255,255,0.4)',
    cursor: 'pointer',
    flexShrink: 0,
    padding: 0,
  },
  label: {
    flex: 1,
    fontSize: '13px',
    color: 'rgba(255,255,255,0.7)',
    cursor: 'text',
    padding: '2px 4px',
    borderRadius: '4px',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  input: {
    flex: 1,
    fontSize: '13px',
    color: '#e2e8f0',
    background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(99,102,241,0.5)',
    borderRadius: '4px',
    padding: '2px 6px',
    outline: 'none',
    fontFamily: 'inherit',
    minWidth: 0,
  },
  deleteBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
    height: '20px',
    border: 'none',
    borderRadius: '4px',
    background: 'transparent',
    color: 'rgba(255,255,255,0.3)',
    cursor: 'pointer',
    flexShrink: 0,
    padding: 0,
  },
  actions: {
    display: 'flex',
    gap: '6px',
    padding: '6px 0',
    borderTop: '1px solid rgba(255,255,255,0.06)',
    marginTop: '4px',
  },
  addFolderBtn: {
    padding: '4px 10px',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '6px',
    background: 'transparent',
    color: 'rgba(255,255,255,0.5)',
    fontSize: '11px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  resetBtn: {
    padding: '4px 10px',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '6px',
    background: 'transparent',
    color: 'rgba(239,68,68,0.7)',
    fontSize: '11px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    marginLeft: 'auto',
  },
  footer: {
    display: 'flex',
    gap: '6px',
    justifyContent: 'flex-end',
    padding: '8px 0 0',
    borderTop: '1px solid rgba(255,255,255,0.06)',
  },
  cancelBtn: {
    padding: '6px 14px',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    background: 'transparent',
    color: 'rgba(255,255,255,0.5)',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  saveBtn: {
    padding: '6px 14px',
    border: 'none',
    borderRadius: '8px',
    background: 'rgba(99,102,241,0.8)',
    color: '#fff',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
};
