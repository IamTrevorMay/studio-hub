import React, { useState, useCallback } from 'react';
import { Droppable, Draggable } from '@hello-pangea/dnd';
import CanvasBlock from './CanvasBlock';
import BlockStyleEditor from './BlockStyleEditor';

export default function NewsletterCanvas({ canvas, sectionsById, onChange }) {
  const [selectedId, setSelectedId] = useState(null);

  const handleBlockClick = useCallback((blockId, e) => {
    e.stopPropagation();
    setSelectedId(blockId);
  }, []);

  const handleCanvasClick = useCallback(() => {
    setSelectedId(null);
  }, []);

  const handleBlockUpdate = useCallback((updated) => {
    onChange(canvas.map(b => b.id === updated.id ? updated : b));
  }, [canvas, onChange]);

  const handleDelete = useCallback((blockId, e) => {
    e.stopPropagation();
    onChange(canvas.filter(b => b.id !== blockId));
    if (selectedId === blockId) setSelectedId(null);
  }, [canvas, onChange, selectedId]);

  const selectedBlock = selectedId ? canvas.find(b => b.id === selectedId) : null;

  return (
    <div style={styles.wrapper} onClick={handleCanvasClick}>
      {/* Email preview container */}
      <div style={styles.emailOuter}>
        <Droppable droppableId="canvas">
          {(provided, snapshot) => (
            <div
              ref={provided.innerRef}
              {...provided.droppableProps}
              style={{
                ...styles.emailInner,
                ...(snapshot.isDraggingOver ? styles.emailDragOver : {}),
              }}
            >
              {canvas.length === 0 && !snapshot.isDraggingOver ? (
                <div style={styles.empty}>
                  <div style={styles.emptyIcon}>
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <rect x="3" y="3" width="18" height="6" rx="1" />
                      <rect x="3" y="13" width="18" height="6" rx="1" />
                    </svg>
                  </div>
                  <div style={styles.emptyTitle}>Drag blocks here to start building</div>
                  <div style={styles.emptyHint}>Add headings, text, images, and AI sections from the toolbox on the right.</div>
                </div>
              ) : (
                canvas.map((block, index) => (
                  <Draggable key={block.id} draggableId={block.id} index={index}>
                    {(dragProvided, dragSnapshot) => (
                      <div
                        ref={dragProvided.innerRef}
                        {...dragProvided.draggableProps}
                        style={{
                          ...dragProvided.draggableProps.style,
                          marginBottom: '2px',
                        }}
                      >
                        <div
                          style={{
                            ...styles.blockWrap,
                            ...(selectedId === block.id ? styles.blockSelected : {}),
                            ...(dragSnapshot.isDragging ? styles.blockDragging : {}),
                          }}
                          onClick={(e) => handleBlockClick(block.id, e)}
                        >
                          {/* Drag handle + delete (visible on hover/select) */}
                          <div style={{
                            ...styles.blockControls,
                            opacity: selectedId === block.id ? 1 : undefined,
                          }}>
                            <div {...dragProvided.dragHandleProps} style={styles.dragHandle} title="Drag to reorder">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                                <circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/>
                                <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
                                <circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/>
                              </svg>
                            </div>
                            <button
                              onClick={(e) => handleDelete(block.id, e)}
                              style={styles.deleteBtn}
                              title="Delete block"
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                              </svg>
                            </button>
                          </div>

                          {/* Block content */}
                          <div style={styles.blockContent}>
                            <CanvasBlock
                              block={block}
                              selected={selectedId === block.id}
                              sectionsById={sectionsById}
                              onUpdate={handleBlockUpdate}
                              onClick={(e) => handleBlockClick(block.id, e)}
                            />
                          </div>
                        </div>

                        {/* Style editor below selected block */}
                        {selectedId === block.id && selectedBlock && (
                          <BlockStyleEditor
                            block={selectedBlock}
                            onUpdate={handleBlockUpdate}
                          />
                        )}
                      </div>
                    )}
                  </Draggable>
                ))
              )}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </div>
    </div>
  );
}

const styles = {
  wrapper: {
    flex: 1,
    overflowY: 'auto',
    background: '#2a2a3d',
    padding: '24px',
  },
  emailOuter: {
    maxWidth: '620px',
    margin: '0 auto',
    background: '#ffffff',
    borderRadius: '8px',
    boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
    minHeight: '200px',
  },
  emailInner: {
    padding: '28px',
    minHeight: '160px',
    transition: 'background 0.15s',
  },
  emailDragOver: {
    background: '#f8fafc',
  },
  empty: {
    textAlign: 'center',
    padding: '48px 24px',
  },
  emptyIcon: {
    color: '#cbd5e1',
    marginBottom: '12px',
  },
  emptyTitle: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#64748b',
    marginBottom: '6px',
  },
  emptyHint: {
    fontSize: '12px',
    color: '#94a3b8',
    maxWidth: '280px',
    margin: '0 auto',
    lineHeight: 1.5,
  },
  blockWrap: {
    position: 'relative',
    borderRadius: '4px',
    border: '1px solid transparent',
    padding: '4px 8px',
    transition: 'border-color 0.12s, box-shadow 0.12s',
    cursor: 'pointer',
  },
  blockSelected: {
    borderColor: '#6366f1',
    boxShadow: '0 0 0 2px rgba(99,102,241,0.15)',
  },
  blockDragging: {
    background: '#ffffff',
    boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
    borderColor: 'rgba(99,102,241,0.3)',
  },
  blockControls: {
    position: 'absolute',
    left: '-32px',
    top: '2px',
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    opacity: 0,
    transition: 'opacity 0.12s',
  },
  dragHandle: {
    color: '#94a3b8',
    cursor: 'grab',
    padding: '3px',
    borderRadius: '3px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtn: {
    background: 'none',
    border: 'none',
    color: '#ef4444',
    cursor: 'pointer',
    padding: '3px',
    borderRadius: '3px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.6,
  },
  blockContent: {
    position: 'relative',
  },
};
