import React from 'react';
import MetadataFields from './MetadataFields';
import { getMediaCategory } from './organizeConstants';

export default function FileCard({ file, meta, onMetaChange, onPreview }) {
  const category = getMediaCategory(file.ext);

  return (
    <div style={styles.card}>
      <div
        style={styles.thumbWrap}
        onClick={() => onPreview(file)}
      >
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
      </div>
      <div style={styles.info}>
        <div style={styles.fileName} title={file.name}>{file.name}</div>
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
  fileName: {
    fontSize: '12px',
    color: 'rgba(255,255,255,0.5)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
};
