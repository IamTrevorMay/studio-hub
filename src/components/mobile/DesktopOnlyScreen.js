import React from 'react';
import { mobileTokens, mobileTapButton } from '../../utils/mobileTokens';

// Shown when a mobile user lands on a tab marked 'excluded' in mobileNavConfig.
// Friendly explainer + back button. Optional onBack handler routes back to Dashboard.
//
// Props:
//   pageLabel?: string  // e.g. "Whiteboard"
//   onBack?: () => void
export default function DesktopOnlyScreen({ pageLabel, onBack }) {
  return (
    <div style={styles.root}>
      <div style={styles.card}>
        <div style={styles.icon}>
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="6" y="10" width="36" height="24" rx="2" />
            <path d="M18 38h12M24 34v4" strokeLinecap="round" />
          </svg>
        </div>
        <h2 style={styles.title}>Best viewed on desktop</h2>
        <p style={styles.body}>
          {pageLabel ? `${pageLabel} is` : 'This page is'} optimized for a larger screen.
          Open Mayday Studio on your computer to use it.
        </p>
        {onBack && (
          <button onClick={onBack} style={{ ...mobileTapButton, ...styles.backBtn }}>
            Back to Dashboard
          </button>
        )}
      </div>
    </div>
  );
}

const styles = {
  root: {
    minHeight: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: mobileTokens.space.xxxl,
    background: '#0f0f1a',
    color: '#e2e8f0',
    fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
  },
  card: {
    maxWidth: 360,
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: mobileTokens.space.md,
  },
  icon: {
    width: 80,
    height: 80,
    borderRadius: mobileTokens.radius.xl,
    background: 'rgba(99,102,241,0.12)',
    color: '#a5b4fc',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: mobileTokens.space.sm,
  },
  title: {
    margin: 0,
    fontSize: mobileTokens.font.xl,
    fontWeight: 700,
    color: '#fff',
    letterSpacing: '-0.3px',
  },
  body: {
    margin: 0,
    fontSize: mobileTokens.font.md,
    color: 'rgba(255,255,255,0.6)',
    lineHeight: 1.5,
  },
  backBtn: {
    marginTop: mobileTokens.space.md,
    padding: `${mobileTokens.space.md}px ${mobileTokens.space.xl}px`,
    background: 'linear-gradient(135deg, #6366f1, #818cf8)',
    color: '#fff',
    borderRadius: mobileTokens.radius.md,
    fontWeight: 600,
    fontSize: mobileTokens.font.md,
  },
};
