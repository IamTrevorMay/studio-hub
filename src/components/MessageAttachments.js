import React, { useState, useEffect, useCallback } from 'react';
import { colors, radii, spacing, zIndex, fontSizes, fontWeights } from '../lib/styleTokens';
import { modalOverlay } from '../lib/styleRecipes';
import { isPdfAttachment, downloadUrl } from '../lib/messageImages';

// Shared inline attachments for Messages (DMs) + Channels, desktop + mobile.
// Images render as clickable thumbnails that open a lightbox; PDFs render as a
// downloadable file card. Every attachment is a real <a href> so any user can
// right-click → "Save link/image as", and both surfaces expose an explicit
// Download action for a reliable one-click save (fetch-blob, cross-origin safe).

function formatBytes(n) {
  if (!n || n <= 0) return null;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function ImageLightbox({ src, alt, name, onClose }) {
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
      <div style={styles.lightboxActions} onClick={(e) => e.stopPropagation()}>
        <button style={styles.lightboxBtn} onClick={() => downloadUrl(src, name)} aria-label="Download image">Download</button>
        <button style={styles.lightboxBtn} onClick={onClose} aria-label="Close image">✕</button>
      </div>
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
      {attachments.map((a, i) => {
        if (isPdfAttachment(a)) {
          const size = formatBytes(a.size);
          return (
            <div key={a.url || i} style={styles.pdfCard}>
              {/* Real link: left-click opens the PDF; right-click → Save link as. */}
              <a
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                style={styles.pdfMain}
                title={a.name ? `Open ${a.name}` : 'Open PDF'}
              >
                <span style={styles.pdfIcon}>PDF</span>
                <span style={styles.pdfText}>
                  <span style={styles.pdfName}>{a.name || 'Document.pdf'}</span>
                  {size && <span style={styles.pdfSize}>{size}</span>}
                </span>
              </a>
              <button
                type="button"
                style={styles.pdfDownload}
                onClick={() => downloadUrl(a.url, a.name)}
                title="Download"
                aria-label={a.name ? `Download ${a.name}` : 'Download PDF'}
              >
                ↓
              </button>
            </div>
          );
        }
        // Image: a real anchor enables native right-click "Save image as";
        // left-click is intercepted to open the in-app lightbox instead.
        return (
          <a
            key={a.url || i}
            href={a.url}
            target="_blank"
            rel="noopener noreferrer"
            style={styles.thumbBtn}
            onClick={(e) => { e.preventDefault(); setLightbox(a); }}
            title={a.name || 'Open image'}
            aria-label={a.name ? `Open ${a.name}` : 'Open image'}
          >
            <img src={a.url} alt={a.name || 'attachment'} style={styles.thumbImg} loading="lazy" />
          </a>
        );
      })}
      {lightbox && <ImageLightbox src={lightbox.url} alt={lightbox.name} name={lightbox.name} onClose={close} />}
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
  // ── PDF file card ──
  pdfCard: {
    display: 'flex', alignItems: 'stretch', gap: spacing.xs,
    border: `1px solid ${colors.border}`, borderRadius: radii.lg,
    background: colors.bgInput, overflow: 'hidden', maxWidth: 'min(320px, 80vw)',
  },
  pdfMain: {
    display: 'flex', alignItems: 'center', gap: spacing.sm, padding: spacing.sm,
    textDecoration: 'none', color: 'inherit', minWidth: 0, flex: 1,
  },
  pdfIcon: {
    flexShrink: 0, width: 34, height: 34, borderRadius: radii.md,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: colors.danger.bg, color: colors.danger.fgSoft,
    fontSize: fontSizes.xxs, fontWeight: fontWeights.bold, letterSpacing: 0.5,
  },
  pdfText: { display: 'flex', flexDirection: 'column', minWidth: 0 },
  pdfName: {
    fontSize: fontSizes.sm, fontWeight: fontWeights.semibold, color: colors.text,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220,
  },
  pdfSize: { fontSize: fontSizes.xxs, color: colors.textSubtle },
  pdfDownload: {
    flexShrink: 0, width: 40, border: 'none', borderLeft: `1px solid ${colors.border}`,
    background: 'transparent', color: colors.textMuted, cursor: 'pointer',
    fontSize: fontSizes.lg, lineHeight: 1,
  },
  // ── Lightbox ──
  lightboxActions: {
    position: 'fixed', top: spacing.lg, right: spacing.lg, display: 'flex', gap: spacing.sm,
    zIndex: zIndex.modal + 1,
  },
  lightboxBtn: {
    height: 36, minWidth: 36, padding: `0 ${spacing.md}px`, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: radii.md,
    color: colors.white, fontSize: fontSizes.md, fontWeight: fontWeights.semibold, cursor: 'pointer',
  },
  lightboxImg: {
    maxWidth: '92vw', maxHeight: '88vh', width: 'auto', height: 'auto',
    borderRadius: radii.md, boxShadow: '0 20px 60px rgba(0,0,0,0.6)', cursor: 'default',
    objectFit: 'contain',
  },
};
