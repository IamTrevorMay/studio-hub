import React from 'react';
import MetadataFields from './MetadataFields';
import AiBadge from './AiBadge';
import { getMediaCategory } from './organizeConstants';

export default function FileRow({ file, meta, onMetaChange, onPreview, selected, onToggleSelect, modified, onMoveBack, aiConf, confThreshold }) {
  const category = getMediaCategory(file.ext);

  return (
    <div style={{ ...styles.row, ...(modified && !selected ? styles.rowModified : {}), ...(selected ? styles.rowSelected : {}) }}>
      <div
        style={styles.checkCol}
        onClick={() => onToggleSelect?.()}
      >
        <div style={{ ...styles.checkbox, ...(selected ? styles.checkboxChecked : {}) }}>
          {selected && (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1.5 5l2.5 2.5 4.5-5" />
            </svg>
          )}
        </div>
      </div>
      <div style={styles.thumbCol} onClick={() => onPreview(file)}>
        {(category === 'image' || category === 'video') && file.thumbUrl ? (
          <img src={file.thumbUrl} alt={file.name} style={styles.thumb} />
        ) : (
          <div style={styles.thumbPlaceholder}>
            {category === 'audio' ? '\u266B' : '\u25A1'}
          </div>
        )}
      </div>
      <div style={styles.nameCol} title={file.name}>{file.name}</div>
      {typeof aiConf === 'number' && <AiBadge conf={aiConf} threshold={confThreshold} />}
      <MetadataFields meta={meta} onChange={onMetaChange} layout="horizontal" />
      {onMoveBack && (
        <button style={styles.moveBackBtn} onClick={onMoveBack} title="Move back to unorganized">
          ↩
        </button>
      )}
    </div>
  );
}

const styles = {
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '8px 12px',
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.05)',
    borderRadius: '8px',
  },
  rowSelected: {
    border: '1px solid rgba(99,102,241,0.4)',
    background: 'rgba(99,102,241,0.05)',
  },
  rowModified: {
    border: '1px solid rgba(34,197,94,0.35)',
    background: 'rgba(34,197,94,0.05)',
  },
  checkCol: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
    flexShrink: 0,
    cursor: 'pointer',
  },
  checkbox: {
    width: '18px',
    height: '18px',
    borderRadius: '4px',
    border: '2px solid rgba(255,255,255,0.3)',
    background: 'transparent',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.12s',
  },
  checkboxChecked: {
    border: '2px solid #6366f1',
    background: '#6366f1',
  },
  thumbCol: {
    width: '48px',
    height: '36px',
    borderRadius: '4px',
    overflow: 'hidden',
    flexShrink: 0,
    cursor: 'pointer',
    background: 'rgba(0,0,0,0.3)',
  },
  thumb: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  thumbPlaceholder: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'rgba(255,255,255,0.2)',
    fontSize: '16px',
  },
  moveBackBtn: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.3)',
    fontSize: '16px',
    cursor: 'pointer',
    padding: '0 4px',
    fontFamily: 'inherit',
    flexShrink: 0,
    transition: 'color 0.12s',
  },
  nameCol: {
    width: '160px',
    flexShrink: 0,
    fontSize: '13px',
    color: 'rgba(255,255,255,0.6)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
};
