import React from 'react';
import { getMediaCategory } from './organizeConstants';
import backdropDismiss from '../../../lib/backdropDismiss';

export default function MediaPreview({ file, onClose }) {
  if (!file) return null;
  const category = getMediaCategory(file.ext);

  return (
    <div style={styles.overlay} {...backdropDismiss(onClose)}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <button style={styles.closeBtn} onClick={onClose}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
        <div style={styles.fileName}>{file.name}</div>
        <div style={styles.content}>
          {category === 'video' ? (
            <video
              src={file.thumbUrl}
              controls
              autoPlay
              style={styles.media}
            />
          ) : category === 'audio' ? (
            <div style={styles.audioWrap}>
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5">
                <path d="M9 18V5l12-2v13M9 18a3 3 0 11-6 0 3 3 0 016 0zM21 16a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <audio src={file.thumbUrl} controls autoPlay style={styles.audio} />
            </div>
          ) : (
            <img src={file.thumbUrl} alt={file.name} style={styles.media} />
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.85)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    position: 'relative',
    background: '#1a1a2e',
    borderRadius: '14px',
    border: '1px solid rgba(255,255,255,0.1)',
    maxWidth: '90vw',
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  closeBtn: {
    position: 'absolute',
    top: '12px',
    right: '12px',
    background: 'rgba(255,255,255,0.1)',
    border: 'none',
    borderRadius: '8px',
    color: '#e2e8f0',
    padding: '6px',
    cursor: 'pointer',
    zIndex: 1,
    display: 'flex',
  },
  fileName: {
    padding: '16px 20px 8px',
    fontSize: '14px',
    fontWeight: 600,
    color: '#e2e8f0',
  },
  content: {
    padding: '8px 20px 20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  media: {
    maxWidth: '80vw',
    maxHeight: '75vh',
    borderRadius: '8px',
  },
  audioWrap: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '24px',
    padding: '40px',
  },
  audio: {
    width: '400px',
  },
};
