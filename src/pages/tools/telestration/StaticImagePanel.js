import React, { useRef } from 'react';

export default function StaticImagePanel({ images, selectedId, onSelect, onAddImages }) {
  const fileInputRef = useRef(null);

  function handleFiles(e) {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) onAddImages(files);
    e.target.value = '';
  }

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <span style={styles.headerTitle}>Images ({images.length})</span>
        <button
          style={styles.addBtn}
          onClick={() => fileInputRef.current?.click()}
          title="Add images"
        >
          + Add
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/jpg"
          style={{ display: 'none' }}
          onChange={handleFiles}
        />
      </div>

      <div style={styles.list}>
        {images.length === 0 ? (
          <div style={styles.emptyState}>
            <div style={styles.emptyIcon}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </div>
            <span style={styles.emptyText}>No images loaded</span>
          </div>
        ) : (
          images.map(img => (
            <button
              key={img.id}
              style={{
                ...styles.card,
                ...(img.id === selectedId ? styles.cardSelected : {}),
              }}
              onClick={() => onSelect(img.id)}
            >
              <div style={styles.thumbWrap}>
                <img
                  src={img.url}
                  alt={img.name}
                  style={styles.thumb}
                  draggable={false}
                />
              </div>
              <div style={styles.cardName} title={img.name}>
                {img.name}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

const styles = {
  panel: {
    width: '220px',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    background: 'rgba(255,255,255,0.02)',
    borderLeft: '1px solid rgba(255,255,255,0.06)',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 12px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    flexShrink: 0,
  },
  headerTitle: {
    flex: 1,
    fontSize: '12px',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  addBtn: {
    background: 'rgba(99,102,241,0.15)',
    border: '1px solid rgba(99,102,241,0.3)',
    color: '#a5b4fc',
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: '5px',
    fontSize: '12px',
    fontFamily: 'inherit',
    fontWeight: 600,
    transition: 'background 0.12s',
  },
  list: {
    flex: 1,
    overflowY: 'auto',
    padding: '8px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    padding: '32px 16px',
    textAlign: 'center',
  },
  emptyIcon: {
    opacity: 0.5,
  },
  emptyText: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.25)',
  },
  card: {
    background: 'none',
    border: '2px solid transparent',
    borderRadius: '8px',
    cursor: 'pointer',
    padding: '6px',
    textAlign: 'left',
    transition: 'border-color 0.12s, background 0.12s',
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
    width: '100%',
  },
  cardSelected: {
    borderColor: '#6366f1',
    background: 'rgba(99,102,241,0.08)',
  },
  thumbWrap: {
    width: '100%',
    aspectRatio: '16/9',
    background: 'rgba(0,0,0,0.4)',
    borderRadius: '4px',
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumb: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    display: 'block',
  },
  cardName: {
    fontSize: '11px',
    color: 'rgba(255,255,255,0.5)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    padding: '0 2px',
  },
};
