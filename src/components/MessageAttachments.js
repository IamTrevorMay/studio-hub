import React, { useState, useEffect, useCallback } from 'react';
import { colors, radii, spacing, zIndex, fontSizes } from '../lib/styleTokens';
import { modalOverlay } from '../lib/styleRecipes';

// Shared inline image attachments for Messages (DMs) + Channels, desktop + mobile.
// Renders a clickable thumbnail grid; clicking opens a lightweight in-app
// lightbox (click anywhere or press Esc to close). Self-styled from tokens so
// the four chat page twins render attachments identically.

function ImageLightbox({ src, alt, onClose }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      style={{ ...modalOverlay(), zIndex: zIndex.modal, background: 'rgba(0,0,0,0.85)', padding: spacing.xl, cursor: 'zoom-out' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <button style={styles.lightboxClose} onClick={onClose} aria-label="Close image">✕</button>
      <img
        src={src}
        alt={alt || 'attachment'}
        style={styles.lightboxImg}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

export default function MessageAttachments({ attachments }) {
  const [lightbox, setLightbox] = useState(null); // { url, name }
  const close = useCallback(() => setLightbox(null), []);

  if (!Array.isArray(attachments) || attachments.length === 0) return null;

  return (
    <div style={styles.grid}>
      {attachments.map((a, i) => (
        <button
          key={a.url || i}
          type="button"
          style={styles.thumbBtn}
          onClick={() => setLightbox(a)}
          title={a.name || 'Open image'}
          aria-label={a.name ? `Open ${a.name}` : 'Open image'}
        >
          <img src={a.url} alt={a.name || 'attachment'} style={styles.thumbImg} loading="lazy" />
        </button>
      ))}
      {lightbox && <ImageLightbox src={lightbox.url} alt={lightbox.name} onClose={close} />}
    </div>
  );
}

const styles = {
  grid: {
    display: 'flex', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs,
  },
  thumbBtn: {
    display: 'block', padding: 0, border: `1px solid ${colors.border}`,
    borderRadius: radii.lg, overflow: 'hidden', background: 'none',
    cursor: 'zoom-in', lineHeight: 0, maxWidth: 'min(260px, 72vw)',
  },
  thumbImg: {
    maxWidth: 'min(260px, 72vw)', maxHeight: 320, width: 'auto', height: 'auto',
    display: 'block', objectFit: 'cover',
  },
  lightboxClose: {
    position: 'fixed', top: spacing.lg, right: spacing.lg,
    width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: radii.circle,
    color: colors.white, fontSize: fontSizes.lg, cursor: 'pointer', zIndex: zIndex.modal + 1,
  },
  lightboxImg: {
    maxWidth: '92vw', maxHeight: '88vh', width: 'auto', height: 'auto',
    borderRadius: radii.md, boxShadow: '0 20px 60px rgba(0,0,0,0.6)', cursor: 'default',
    objectFit: 'contain',
  },
};
