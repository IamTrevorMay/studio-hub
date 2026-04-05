import React, { useState, useCallback } from 'react';

// Canvas that holds the ordered list of sections in a report.
// Accepts drops from the library and supports reorder + remove.

const KIND_COLORS = {
  brief: '#f59e0b',
  cards: '#8b5cf6',
  trends: '#10b981',
  news: '#06b6d4',
  custom: '#6366f1',
};

export default function SectionComposer({ sectionIds, sectionsById, onChange }) {
  const [dragOver, setDragOver] = useState(false);
  const [dragIndex, setDragIndex] = useState(null);

  const handleDropOnCanvas = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const id = e.dataTransfer.getData('text/section-id');
    if (!id) return;
    if (sectionIds.includes(id)) return;
    onChange([...sectionIds, id]);
  }, [sectionIds, onChange]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('text/section-id')) setDragOver(true);
  }, []);

  const handleRemove = useCallback((index) => {
    onChange(sectionIds.filter((_, i) => i !== index));
  }, [sectionIds, onChange]);

  const handleReorderDragStart = useCallback((index, e) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/reorder-index', String(index));
  }, []);

  const handleReorderDrop = useCallback((targetIndex, e) => {
    e.preventDefault();
    e.stopPropagation();
    const src = Number(e.dataTransfer.getData('text/reorder-index'));
    if (Number.isNaN(src) || src === targetIndex) return;
    const next = [...sectionIds];
    const [moved] = next.splice(src, 1);
    next.splice(targetIndex, 0, moved);
    onChange(next);
    setDragIndex(null);
  }, [sectionIds, onChange]);

  const sections = sectionIds.map(id => sectionsById.get(id)).filter(Boolean);

  return (
    <div
      style={{
        ...styles.canvas,
        ...(dragOver ? styles.canvasDragOver : {}),
      }}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDropOnCanvas}
    >
      {sections.length === 0 ? (
        <div style={styles.empty}>
          <div style={styles.emptyIcon}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="6" rx="1" />
              <rect x="3" y="13" width="18" height="6" rx="1" />
            </svg>
          </div>
          <div style={styles.emptyTitle}>Drop sections here</div>
          <div style={styles.emptyHint}>Drag from the library on the right, or click a section to add it.</div>
        </div>
      ) : (
        sections.map((section, i) => (
          <div
            key={`${section.id}-${i}`}
            draggable
            onDragStart={(e) => handleReorderDragStart(i, e)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => handleReorderDrop(i, e)}
            style={{
              ...styles.card,
              ...(dragIndex === i ? styles.cardDragging : {}),
            }}
          >
            <div style={{ ...styles.kindStripe, background: KIND_COLORS[section.kind] || KIND_COLORS.custom }} />
            <div style={styles.cardBody}>
              <div style={styles.cardHeader}>
                <span style={styles.orderNum}>{i + 1}</span>
                <span style={styles.cardName}>{section.name}</span>
                <span style={styles.kindBadge}>{section.kind}</span>
              </div>
              {section.description && (
                <div style={styles.cardDesc}>{section.description}</div>
              )}
            </div>
            <button
              onClick={() => handleRemove(i)}
              style={styles.removeBtn}
              title="Remove from report"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        ))
      )}
    </div>
  );
}

const styles = {
  canvas: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '12px',
    minHeight: '120px',
    background: 'rgba(255,255,255,0.02)',
    border: '1px dashed rgba(255,255,255,0.1)',
    borderRadius: '8px',
    transition: 'border-color 0.15s, background 0.15s',
  },
  canvasDragOver: {
    background: 'rgba(99,102,241,0.08)',
    borderColor: 'rgba(99,102,241,0.5)',
  },
  empty: {
    textAlign: 'center',
    padding: '24px 12px',
    color: 'rgba(255,255,255,0.3)',
  },
  emptyIcon: {
    color: 'rgba(255,255,255,0.2)',
    marginBottom: '10px',
  },
  emptyTitle: {
    fontSize: '13px',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.5)',
    marginBottom: '4px',
  },
  emptyHint: {
    fontSize: '11px',
    color: 'rgba(255,255,255,0.3)',
  },
  card: {
    display: 'flex',
    alignItems: 'stretch',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '6px',
    overflow: 'hidden',
    cursor: 'grab',
    transition: 'opacity 0.12s, border-color 0.12s',
  },
  cardDragging: {
    opacity: 0.4,
  },
  kindStripe: {
    width: '3px',
    flexShrink: 0,
  },
  cardBody: {
    flex: 1,
    padding: '10px 12px',
    minWidth: 0,
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '2px',
  },
  orderNum: {
    fontSize: '10px',
    fontWeight: 700,
    color: 'rgba(255,255,255,0.3)',
    width: '16px',
  },
  cardName: {
    fontSize: '13px',
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
    color: 'rgba(255,255,255,0.5)',
    background: 'rgba(255,255,255,0.06)',
    padding: '2px 6px',
    borderRadius: '3px',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  cardDesc: {
    fontSize: '11px',
    color: 'rgba(255,255,255,0.4)',
    lineHeight: 1.4,
    paddingLeft: '24px',
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
  },
  removeBtn: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.3)',
    cursor: 'pointer',
    padding: '0 10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
};
