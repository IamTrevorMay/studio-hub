import React, { useState } from 'react';
import { Droppable, Draggable } from '@hello-pangea/dnd';
import SectionGenerator from './SectionGenerator';

// Right-panel library of all report_sections. Drag onto the composer canvas,
// or click + to add. Includes the inline generator at the top.
// Uses @hello-pangea/dnd for drag — items are Draggable inside a non-droppable Droppable.

const KIND_COLORS = {
  brief: '#f59e0b',
  cards: '#8b5cf6',
  trends: '#10b981',
  news: '#06b6d4',
  custom: '#6366f1',
};

export default function SectionsLibrary({ sections, selectedIds, onAdd, onGenerated, onPreview, onDelete }) {
  const [filter, setFilter] = useState('');

  const filtered = sections.filter(s => {
    if (!filter) return true;
    const f = filter.toLowerCase();
    return (s.name || '').toLowerCase().includes(f) || (s.description || '').toLowerCase().includes(f);
  });

  return (
    <div style={styles.container}>
      <div style={styles.scrollArea}>
        <SectionGenerator onSaved={onGenerated} onPreview={onPreview} />

        <div style={styles.divider} />

        <div style={styles.headerRow}>
          <div style={styles.label}>Library</div>
          <span style={styles.count}>{sections.length}</span>
        </div>

        <input
          style={styles.filterInput}
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Search sections…"
        />

        <Droppable droppableId="sections-library" isDropDisabled={true}>
          {(provided) => (
            <div ref={provided.innerRef} {...provided.droppableProps} style={styles.list}>
              {filtered.length === 0 ? (
                <div style={styles.empty}>No sections match.</div>
              ) : (
                filtered.map((section, index) => {
                  const inReport = selectedIds.includes(section.id);
                  return (
                    <Draggable key={section.id} draggableId={`section-${section.id}`} index={index}>
                      {(dragProvided, dragSnapshot) => (
                        <>
                          <div
                            ref={dragProvided.innerRef}
                            {...dragProvided.draggableProps}
                            {...dragProvided.dragHandleProps}
                            style={{
                              ...styles.card,
                              ...(inReport ? styles.cardInReport : {}),
                              ...(dragSnapshot.isDragging ? styles.cardDragging : {}),
                              ...dragProvided.draggableProps.style,
                            }}
                            title="Drag onto the canvas or click + to add"
                          >
                            <div style={{ ...styles.stripe, background: KIND_COLORS[section.kind] || KIND_COLORS.custom }} />
                            <div style={styles.body}>
                              <div style={styles.row}>
                                <span style={styles.name}>{section.name}</span>
                                <span style={styles.kindBadge}>{section.kind}</span>
                              </div>
                              {section.description && <div style={styles.desc}>{section.description}</div>}
                              {section.is_seed && <span style={styles.seedBadge}>seed</span>}
                            </div>
                            <div style={styles.actions}>
                              <button
                                onClick={() => onAdd(section.id)}
                                disabled={inReport}
                                style={{ ...styles.addBtn, ...(inReport ? styles.addBtnAdded : {}) }}
                                title={inReport ? 'Already in report' : 'Add to report'}
                              >
                                {inReport ? (
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                                ) : (
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                                )}
                              </button>
                              {!section.is_seed && onDelete && (
                                <button
                                  onClick={() => {
                                    if (window.confirm(`Delete "${section.name}" from the library?`)) onDelete(section.id);
                                  }}
                                  style={styles.deleteBtn}
                                  title="Delete from library"
                                >
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <polyline points="3 6 5 6 21 6" /><path d="M19 6l-2 14H7L5 6" /><path d="M10 11v6M14 11v6" />
                                  </svg>
                                </button>
                              )}
                            </div>
                          </div>
                          {/* Clone left behind when dragging */}
                          {dragSnapshot.isDragging && (
                            <div style={{ ...styles.card, ...(inReport ? styles.cardInReport : {}), opacity: 0.4 }}>
                              <div style={{ ...styles.stripe, background: KIND_COLORS[section.kind] || KIND_COLORS.custom }} />
                              <div style={styles.body}>
                                <div style={styles.row}>
                                  <span style={styles.name}>{section.name}</span>
                                  <span style={styles.kindBadge}>{section.kind}</span>
                                </div>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </Draggable>
                  );
                })
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
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden',
  },
  scrollArea: {
    flex: 1,
    overflowY: 'auto',
    padding: '14px',
  },
  divider: {
    height: '1px',
    background: 'rgba(255,255,255,0.06)',
    margin: '16px 0',
  },
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '8px',
  },
  label: {
    fontSize: '11px',
    fontWeight: 700,
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  count: {
    fontSize: '11px',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.3)',
  },
  filterInput: {
    width: '100%',
    background: 'rgba(0,0,0,0.2)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '6px',
    color: '#ffffff',
    fontSize: '12px',
    padding: '6px 10px',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
    marginBottom: '10px',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  empty: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.3)',
    textAlign: 'center',
    padding: '16px',
  },
  card: {
    display: 'flex',
    alignItems: 'stretch',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '6px',
    overflow: 'hidden',
    cursor: 'grab',
    transition: 'background 0.12s, border-color 0.12s',
  },
  cardInReport: {
    background: 'rgba(34,197,94,0.04)',
    borderColor: 'rgba(34,197,94,0.15)',
  },
  cardDragging: {
    background: 'rgba(99,102,241,0.08)',
    borderColor: 'rgba(99,102,241,0.3)',
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
  },
  stripe: {
    width: '3px',
    flexShrink: 0,
  },
  body: {
    flex: 1,
    padding: '8px 10px',
    minWidth: 0,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginBottom: '2px',
  },
  name: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#e2e8f0',
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  kindBadge: {
    fontSize: '9px',
    fontWeight: 700,
    color: 'rgba(255,255,255,0.4)',
    background: 'rgba(255,255,255,0.05)',
    padding: '2px 5px',
    borderRadius: '3px',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  desc: {
    fontSize: '11px',
    color: 'rgba(255,255,255,0.4)',
    lineHeight: 1.4,
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
  },
  seedBadge: {
    display: 'inline-block',
    fontSize: '9px',
    fontWeight: 700,
    color: '#f59e0b',
    background: 'rgba(245,158,11,0.1)',
    padding: '1px 5px',
    borderRadius: '3px',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginTop: '4px',
  },
  actions: {
    display: 'flex',
    flexDirection: 'column',
    borderLeft: '1px solid rgba(255,255,255,0.04)',
  },
  addBtn: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.5)',
    cursor: 'pointer',
    padding: '0 10px',
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
  },
  addBtnAdded: {
    color: '#22c55e',
    cursor: 'default',
  },
  deleteBtn: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.25)',
    cursor: 'pointer',
    padding: '6px 10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
};
