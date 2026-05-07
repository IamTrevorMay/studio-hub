import React from 'react';
import { mobileTokens, mobileTapButton } from '../../utils/mobileTokens';

// Mobile top bar: hamburger (left) + page title (center) + notifications bell (right).
// Sticky to the top of the viewport, respects iOS safe-area inset.
//
// Props:
//   title: string
//   onMenuClick: () => void
//   onBellClick: () => void
//   notificationCount?: number
export default function MobileTopBar({ title, onMenuClick, onBellClick, notificationCount = 0 }) {
  return (
    <header
      style={{
        ...styles.bar,
        paddingTop: `calc(${mobileTokens.space.sm}px + ${mobileTokens.safeTop})`,
      }}
    >
      <button onClick={onMenuClick} style={{ ...mobileTapButton, ...styles.iconBtn }} aria-label="Open menu">
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 6h16M3 11h16M3 16h16" strokeLinecap="round" />
        </svg>
      </button>
      <h1 style={styles.title}>{title}</h1>
      <button onClick={onBellClick} style={{ ...mobileTapButton, ...styles.iconBtn, position: 'relative' }} aria-label="Notifications">
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M17 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9M13 21a2 2 0 01-4 0" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {notificationCount > 0 && (
          <span style={styles.badge}>{notificationCount > 99 ? '99+' : notificationCount}</span>
        )}
      </button>
    </header>
  );
}

const styles = {
  bar: {
    position: 'sticky',
    top: 0,
    zIndex: mobileTokens.z.topBar,
    display: 'grid',
    gridTemplateColumns: `${mobileTokens.tap}px 1fr ${mobileTokens.tap}px`,
    alignItems: 'center',
    gap: mobileTokens.space.sm,
    padding: `${mobileTokens.space.sm}px ${mobileTokens.space.md}px`,
    height: mobileTokens.topBarHeight,
    background: 'rgba(15,15,30,0.95)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    color: '#e2e8f0',
    fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
  },
  iconBtn: {
    color: 'rgba(255,255,255,0.85)',
    borderRadius: mobileTokens.radius.sm,
  },
  title: {
    margin: 0,
    fontSize: mobileTokens.font.lg,
    fontWeight: 700,
    color: '#fff',
    textAlign: 'center',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    letterSpacing: '-0.2px',
  },
  badge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 18,
    height: 18,
    padding: '0 5px',
    background: '#ef4444',
    color: '#fff',
    borderRadius: 9,
    fontSize: 10,
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    lineHeight: 1,
  },
};
