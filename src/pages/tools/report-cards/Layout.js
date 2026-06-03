import React, { useState } from 'react';
import { colors, spacing, radii, fontSizes, fontWeights, fontFamily } from '../../../lib/styleTokens';
import Builder from './Builder';
import Generator from './Generator';

// Top-level Report Cards tool. Two modes:
//   builder   — design a template (Scene), save to report_card_templates.
//   generator — load a saved template, populate from player data, export.
// Mode tab strip lives in this header alongside the back button + title.

export default function Layout({ onBack }) {
  const [mode, setMode] = useState('builder');

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <button onClick={onBack} style={styles.backBtn} title="Back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <span style={styles.headerTitle}>Report Cards</span>

        <div style={styles.tabs}>
          {[
            { k: 'builder', label: 'Builder' },
            { k: 'generator', label: 'Generator' },
          ].map((t) => (
            <button
              key={t.k}
              onClick={() => setMode(t.k)}
              style={{ ...styles.tab, ...(mode === t.k ? styles.tabActive : {}) }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <div style={styles.body}>
        {mode === 'builder' ? <Builder /> : <Generator />}
      </div>
    </div>
  );
}

const styles = {
  container: {
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: colors.bg,
    color: colors.text,
    fontFamily,
  },
  header: {
    height: 52,
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    gap: spacing.md,
    padding: `0 ${spacing.lg}px`,
    borderBottom: `1px solid ${colors.border}`,
    background: colors.bgRaised,
  },
  backBtn: {
    width: 32,
    height: 32,
    border: 'none',
    background: 'transparent',
    color: colors.textMuted,
    cursor: 'pointer',
    borderRadius: radii.sm,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.semibold,
    color: colors.text,
  },
  tabs: {
    marginLeft: spacing.xl,
    display: 'flex',
    gap: spacing.xs,
  },
  tab: {
    padding: `${spacing.xs}px ${spacing.md}px`,
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.medium,
    color: colors.textMuted,
    background: 'transparent',
    border: `1px solid ${colors.border}`,
    borderRadius: radii.sm,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  tabActive: {
    color: colors.accentFg,
    background: colors.accentSoft,
    border: `1px solid ${colors.accentBorder}`,
  },
  body: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
  },
};
