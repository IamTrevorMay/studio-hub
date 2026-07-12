import React, { useEffect, useRef, useState } from 'react';
import { mobileTokens, mobileTapButton } from '../../utils/mobileTokens';
import backdropDismiss from '../../lib/backdropDismiss';

// Lightweight bottom sheet for short content (confirms, quick edit forms,
// notification panel). Long forms/detail views should use FullScreenSheet.
//
// Props:
//   open: boolean
//   onClose: () => void
//   title?: string
//   children
//   maxHeight?: string  // default '85vh'
export default function BottomSheet({ open, onClose, title, children, maxHeight = '85vh' }) {
  const sheetRef = useRef(null);
  const dragStartY = useRef(null);
  const [dragOffset, setDragOffset] = useState(0);

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Escape to close
  useEffect(() => {
    if (!open) return undefined;
    const handler = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Reset drag state when re-opened
  useEffect(() => { if (open) setDragOffset(0); }, [open]);

  if (!open) return null;

  function onTouchStart(e) {
    dragStartY.current = e.touches[0].clientY;
  }
  function onTouchMove(e) {
    if (dragStartY.current == null) return;
    const dy = e.touches[0].clientY - dragStartY.current;
    if (dy > 0) setDragOffset(dy);
  }
  function onTouchEnd() {
    if (dragOffset > 100) onClose?.();
    setDragOffset(0);
    dragStartY.current = null;
  }

  return (
    <div style={styles.backdrop} {...backdropDismiss(onClose)}>
      <div
        ref={sheetRef}
        style={{
          ...styles.sheet,
          maxHeight,
          transform: `translateY(${dragOffset}px)`,
          transition: dragOffset === 0 ? 'transform 0.2s ease-out' : 'none',
          paddingBottom: `calc(${mobileTokens.space.lg}px + ${mobileTokens.safeBottom})`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={styles.handleArea}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          <div style={styles.handle} />
        </div>
        {title && (
          <div style={styles.header}>
            <span style={styles.title}>{title}</span>
            <button onClick={onClose} style={{ ...mobileTapButton, ...styles.closeBtn }} aria-label="Close">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        )}
        <div style={styles.body}>{children}</div>
      </div>
    </div>
  );
}

const styles = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.55)',
    zIndex: mobileTokens.z.backdrop,
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    animation: 'maydayBackdropFade 0.18s ease-out',
  },
  sheet: {
    width: '100%',
    background: '#1a1a2e',
    borderTopLeftRadius: mobileTokens.radius.xl,
    borderTopRightRadius: mobileTokens.radius.xl,
    boxShadow: '0 -12px 40px rgba(0,0,0,0.6)',
    color: '#e2e8f0',
    fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
    fontSize: mobileTokens.font.base,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    animation: 'maydaySheetSlideUp 0.22s ease-out',
  },
  handleArea: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '8px 0 4px',
    flexShrink: 0,
    cursor: 'grab',
    touchAction: 'none',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    background: 'rgba(255,255,255,0.2)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${mobileTokens.space.md}px ${mobileTokens.space.lg}px`,
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    flexShrink: 0,
  },
  title: {
    fontSize: mobileTokens.font.lg,
    fontWeight: 700,
    color: '#fff',
  },
  closeBtn: {
    color: 'rgba(255,255,255,0.6)',
    borderRadius: mobileTokens.radius.sm,
  },
  body: {
    flex: 1,
    overflowY: 'auto',
    padding: mobileTokens.space.lg,
    WebkitOverflowScrolling: 'touch',
  },
};

if (typeof document !== 'undefined' && !document.getElementById('mayday-mobile-sheet-anim')) {
  const styleEl = document.createElement('style');
  styleEl.id = 'mayday-mobile-sheet-anim';
  styleEl.textContent = `
    @keyframes maydayBackdropFade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes maydaySheetSlideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
    @keyframes maydayFullSheetSlideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
    @keyframes maydayDrawerSlideIn { from { transform: translateX(-100%); } to { transform: translateX(0); } }
  `;
  document.head.appendChild(styleEl);
}
