import React, { useCallback } from 'react';

const TYPE_LABELS = {
  pen: 'Pen',
  line: 'Line',
  arrow: 'Arrow',
  circle: 'Circle',
  triangle: 'Triangle',
  square: 'Square',
  highlighter: 'Highlight',
  text: 'Text',
};

function formatTime(seconds) {
  if (!seconds || !isFinite(seconds)) return '00:00.00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const f = Math.floor((seconds % 1) * 30);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(f).padStart(2, '0')}`;
}

function parseTimeInput(str) {
  // Accept MM:SS.FF or MM:SS or just seconds
  const parts = str.split(':');
  if (parts.length === 2) {
    const m = parseInt(parts[0], 10) || 0;
    const sParts = parts[1].split('.');
    const s = parseInt(sParts[0], 10) || 0;
    const f = parseInt(sParts[1], 10) || 0;
    return m * 60 + s + f / 30;
  }
  const val = parseFloat(str);
  return isNaN(val) ? null : val;
}

export default function AnnotationList({
  annotations,
  currentTime,
  onUpdateAnnotation,
  onRemoveAnnotation,
  onSelectAnnotation,
  onClose,
}) {
  const handleSetStart = useCallback((id) => {
    onUpdateAnnotation(id, { startTime: currentTime });
  }, [currentTime, onUpdateAnnotation]);

  const handleSetEnd = useCallback((id) => {
    onUpdateAnnotation(id, { endTime: currentTime });
  }, [currentTime, onUpdateAnnotation]);

  const handleTimeChange = useCallback((id, field, value) => {
    const parsed = parseTimeInput(value);
    if (parsed !== null && parsed >= 0) {
      onUpdateAnnotation(id, { [field]: parsed });
    }
  }, [onUpdateAnnotation]);

  return (
    <div style={styles.panel}>
      <div style={styles.panelHeader}>
        <span style={styles.panelTitle}>Annotations</span>
        <span style={styles.count}>{annotations.length}</span>
        <button onClick={onClose} style={styles.closeBtn} title="Close panel">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div style={styles.list}>
        {annotations.length === 0 && (
          <div style={styles.empty}>No annotations yet. Draw on the video to create one.</div>
        )}

        {annotations.map(ann => {
          const isVisible = currentTime >= ann.startTime && currentTime <= ann.endTime;
          return (
            <div
              key={ann.id}
              style={{
                ...styles.item,
                ...(isVisible ? styles.itemVisible : {}),
              }}
              onClick={() => onSelectAnnotation(ann.id)}
            >
              {/* Top row: color dot, type, delete */}
              <div style={styles.itemTopRow}>
                <div style={{ ...styles.colorDot, background: ann.color }} />
                <span style={styles.typeLabel}>{TYPE_LABELS[ann.type] || ann.type}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); onRemoveAnnotation(ann.id); }}
                  style={styles.deleteBtn}
                  title="Delete annotation"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Time range row */}
              <div style={styles.timeRow}>
                <div style={styles.timeField}>
                  <span style={styles.timeLabel}>In</span>
                  <input
                    style={styles.timeInput}
                    value={formatTime(ann.startTime)}
                    onChange={(e) => handleTimeChange(ann.id, 'startTime', e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <button
                    style={styles.setNowBtn}
                    onClick={(e) => { e.stopPropagation(); handleSetStart(ann.id); }}
                    title="Set to current time"
                  >
                    Now
                  </button>
                </div>
                <div style={styles.timeField}>
                  <span style={styles.timeLabel}>Out</span>
                  <input
                    style={styles.timeInput}
                    value={formatTime(ann.endTime)}
                    onChange={(e) => handleTimeChange(ann.id, 'endTime', e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <button
                    style={styles.setNowBtn}
                    onClick={(e) => { e.stopPropagation(); handleSetEnd(ann.id); }}
                    title="Set to current time"
                  >
                    Now
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const styles = {
  panel: {
    width: '280px',
    flexShrink: 0,
    borderLeft: '1px solid rgba(255,255,255,0.06)',
    display: 'flex',
    flexDirection: 'column',
    background: 'rgba(255,255,255,0.01)',
    overflow: 'hidden',
  },
  panelHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px 14px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    flexShrink: 0,
  },
  panelTitle: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#ffffff',
    flex: 1,
  },
  count: {
    fontSize: '11px',
    color: 'rgba(255,255,255,0.35)',
    background: 'rgba(255,255,255,0.06)',
    padding: '1px 7px',
    borderRadius: '8px',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.35)',
    cursor: 'pointer',
    padding: '4px',
    borderRadius: '4px',
    display: 'flex',
    alignItems: 'center',
  },
  list: {
    flex: 1,
    overflowY: 'auto',
    padding: '8px',
  },
  empty: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.25)',
    textAlign: 'center',
    padding: '24px 12px',
    lineHeight: 1.5,
  },
  item: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.04)',
    borderRadius: '8px',
    padding: '10px',
    marginBottom: '6px',
    cursor: 'pointer',
    transition: 'border-color 0.12s',
  },
  itemVisible: {
    borderColor: 'rgba(99,102,241,0.3)',
    background: 'rgba(99,102,241,0.04)',
  },
  itemTopRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '8px',
  },
  colorDot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    flexShrink: 0,
  },
  typeLabel: {
    fontSize: '12px',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.7)',
    flex: 1,
  },
  deleteBtn: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.2)',
    cursor: 'pointer',
    padding: '2px',
    borderRadius: '4px',
    display: 'flex',
    alignItems: 'center',
    transition: 'color 0.12s',
  },
  timeRow: {
    display: 'flex',
    gap: '6px',
  },
  timeField: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  timeLabel: {
    fontSize: '10px',
    color: 'rgba(255,255,255,0.3)',
    fontWeight: 600,
    textTransform: 'uppercase',
    width: '22px',
    flexShrink: 0,
  },
  timeInput: {
    flex: 1,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '4px',
    color: 'rgba(255,255,255,0.7)',
    fontSize: '11px',
    padding: '3px 5px',
    fontFamily: "'DM Sans', monospace",
    fontVariantNumeric: 'tabular-nums',
    minWidth: 0,
  },
  setNowBtn: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '4px',
    color: 'rgba(255,255,255,0.4)',
    fontSize: '10px',
    fontFamily: 'inherit',
    fontWeight: 600,
    cursor: 'pointer',
    padding: '3px 5px',
    flexShrink: 0,
    transition: 'color 0.12s',
  },
};
