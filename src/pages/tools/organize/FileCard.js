import React from 'react';
import MetadataFields from './MetadataFields';
import AiBadge from './AiBadge';
import { getMediaCategory } from './organizeConstants';
import { colors } from '../../../lib/styleTokens';

export default function FileCard({ file, meta, onMetaChange, onPreview, selected, onToggleSelect, modified, onMoveBack, aiConf, confThreshold }) {
  const category = getMediaCategory(file.ext);

  return (
    <div style={{ ...styles.card, ...(modified && !selected ? styles.cardModified : {}), ...(selected ? styles.cardSelected : {}) }}>
      <div
        style={styles.thumbWrap}
        onClick={() => onPreview(file)}
      >
        <div
          style={styles.checkboxWrap}
          onClick={e => { e.stopPropagation(); onToggleSelect?.(); }}
        >
          <div style={{ ...styles.checkbox, ...(selected ? styles.checkboxChecked : {}) }}>
            {selected && (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1.5 5l2.5 2.5 4.5-5" />
              </svg>
            )}
          </div>
        </div>
        {category === 'video' && file.thumbUrl ? (
          <video src={file.thumbUrl} style={styles.thumb} muted preload="metadata" />
        ) : category === 'image' && file.thumbUrl ? (
          <img src={file.thumbUrl} alt={file.name} style={styles.thumb} />
        ) : (
          <div style={styles.thumbPlaceholder}>
            {category === 'audio' ? (
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5">
                <path d="M9 18V5l12-2v13M9 18a3 3 0 11-6 0 3 3 0 016 0zM21 16a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            ) : (
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M3 15l5-5 4 4 4-6 5 7" />
              </svg>
            )}
          </div>
        )}
        <div style={styles.playOverlay}>
          {category === 'video' && (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z" /></svg>
          )}
        </div>
        {typeof aiConf === 'number' && (
          <div style={styles.aiBadgeWrap}>
            <AiBadge conf={aiConf} threshold={confThreshold} />
          </div>
        )}
      </div>
      <div style={styles.info}>
        <div style={styles.fileNameRow}>
          <div style={styles.fileName} title={file.name}>{file.name}</div>
          {onMoveBack && (
            <button style={styles.moveBackBtn} onClick={onMoveBack} title="Move back to unorganized">
              ↩
            </button>
          )}
        </div>
        <MetadataFields meta={meta} onChange={onMetaChange} />
      </div>
    </div>
  );
}

const styles = {
  card: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '10px',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  cardSelected: {
    border: '1px solid rgba(91, 143, 199,0.5)',
    background: colors.accentA06,
  },
  cardModified: {
    border: '1px solid rgba(34,197,94,0.4)',
    background: 'rgba(34,197,94,0.06)',
  },
  checkboxWrap: {
    position: 'absolute',
    top: '8px',
    left: '8px',
    zIndex: 2,
    padding: '2px',
  },
  aiBadgeWrap: {
    position: 'absolute',
    top: '8px',
    right: '8px',
    zIndex: 2,
  },
  checkbox: {
    width: '18px',
    height: '18px',
    borderRadius: '4px',
    border: '2px solid rgba(255,255,255,0.4)',
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'all 0.12s',
  },
  checkboxChecked: {
    border: '2px solid #5b8fc7',
    background: colors.accent,
  },
  thumbWrap: {
    position: 'relative',
    width: '100%',
    paddingTop: '56.25%',
    background: 'rgba(0,0,0,0.3)',
    cursor: 'pointer',
    overflow: 'hidden',
  },
  thumb: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  thumbPlaceholder: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0,0,0,0.2)',
  },
  playOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.7,
  },
  info: {
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  fileNameRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  fileName: {
    flex: 1,
    fontSize: '12px',
    color: 'rgba(255,255,255,0.5)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  moveBackBtn: {
    flexShrink: 0,
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.3)',
    fontSize: '14px',
    cursor: 'pointer',
    padding: '0 2px',
    fontFamily: 'inherit',
    lineHeight: 1,
    transition: 'color 0.12s',
  },
};
