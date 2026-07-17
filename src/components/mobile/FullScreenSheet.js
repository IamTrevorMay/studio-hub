import React, { useEffect } from 'react';
import { mobileTokens, mobileTapButton } from '../../utils/mobileTokens';

// Full-screen sheet for long content (detail views, multi-field forms).
// Slides up from the bottom, has its own header with back + title + optional action.
//
// Props:
//   open: boolean
//   onClose: () => void
//   title?: string
//   backLabel?: string      // optional text shown next to the back chevron (e.g. "Messages")
//   rightAction?: ReactNode  // optional element rendered on the right of the header
//   children
export default function FullScreenSheet({ open, onClose, title, backLabel, rightAction, children }) {
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const handler = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div style={styles.root}>
      <div style={{
        ...styles.header,
        paddingTop: `calc(${mobileTokens.space.md}px + ${mobileTokens.safeTop})`,
        // Widen the left column so a labeled back button isn't clipped; chevron-only
        // usages keep the original symmetric tap/1fr/tap grid untouched.
        ...(backLabel ? { gridTemplateColumns: `auto 1fr ${mobileTokens.tap}px` } : null),
      }}>
        <button
          onClick={onClose}
          style={{ ...mobileTapButton, ...styles.backBtn, ...(backLabel ? styles.backBtnLabeled : null) }}
          aria-label="Back"
        >
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 4L7 11l7 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {backLabel && <span style={styles.backLabel}>{backLabel}</span>}
        </button>
        <span style={styles.title}>{title || ''}</span>
        <div style={styles.rightSlot}>{rightAction || null}</div>
      </div>
      <div style={{ ...styles.body, paddingBottom: `calc(${mobileTokens.space.lg}px + ${mobileTokens.safeBottom})` }}>
        {children}
      </div>
    </div>
  );
}

const styles = {
  root: {
    position: 'fixed',
    inset: 0,
    background: '#0f0f1a',
    color: '#e2e8f0',
    zIndex: mobileTokens.z.sheet,
    display: 'flex',
    flexDirection: 'column',
    fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
    fontSize: mobileTokens.font.base,
    animation: 'maydayFullSheetSlideUp 0.24s ease-out',
  },
  header: {
    display: 'grid',
    gridTemplateColumns: `${mobileTokens.tap}px 1fr ${mobileTokens.tap}px`,
    alignItems: 'center',
    gap: mobileTokens.space.sm,
    padding: `${mobileTokens.space.md}px ${mobileTokens.space.lg}px`,
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    flexShrink: 0,
  },
  backBtn: {
    color: 'rgba(255,255,255,0.85)',
    borderRadius: mobileTokens.radius.sm,
  },
  backBtnLabeled: {
    justifyContent: 'flex-start',
    gap: 2,
    paddingRight: mobileTokens.space.sm,
  },
  backLabel: {
    fontSize: mobileTokens.font.base,
    fontWeight: 600,
    color: '#a5b4fc',
  },
  title: {
    fontSize: mobileTokens.font.lg,
    fontWeight: 700,
    color: '#fff',
    textAlign: 'center',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  rightSlot: {
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  body: {
    flex: 1,
    overflowY: 'auto',
    padding: mobileTokens.space.lg,
    WebkitOverflowScrolling: 'touch',
  },
};
