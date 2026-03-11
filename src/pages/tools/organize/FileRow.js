import React from 'react';
import MetadataFields from './MetadataFields';
import { getMediaCategory } from './organizeConstants';

export default function FileRow({ file, meta, onMetaChange, onPreview }) {
  const category = getMediaCategory(file.ext);

  return (
    <div style={styles.row}>
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
      <MetadataFields meta={meta} onChange={onMetaChange} layout="horizontal" />
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
