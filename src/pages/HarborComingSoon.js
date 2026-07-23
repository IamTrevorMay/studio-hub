import React from 'react';
import { colors, spacing, radii, fontSizes, fontWeights, fontFamily } from '../lib/styleTokens';
import { pill, button } from '../lib/styleRecipes';

// Branded coming-soon teaser for Harbor ('/harbor') — the suite's podcast &
// remote recording app. Rendered full-screen by AppLayout / AppLayoutMobile
// (staff only). Deliberately never writes suite_last_app: users must not get
// stranded on a teaser page at next login.
export default function HarborComingSoon({ onBackToLauncher }) {
  return (
    <div style={styles.page}>
      <div style={styles.tile}>H</div>
      <h1 style={styles.title}>Harbor</h1>
      <span style={styles.soonPill}>Coming soon</span>
      <p style={styles.tagline}>Podcast & remote recording</p>
      <p style={styles.blurb}>
        Record the show — and remote guests — in studio quality, right inside the
        Mayday Studio suite.
      </p>
      {onBackToLauncher && (
        <button type="button" onClick={onBackToLauncher} style={styles.backBtn}>
          &larr; Back to launcher
        </button>
      )}
    </div>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    background: colors.bg,
    fontFamily,
    color: colors.text,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    padding: spacing.xxl,
    boxSizing: 'border-box',
    textAlign: 'center',
  },
  tile: {
    width: 64,
    height: 64,
    borderRadius: radii.xl,
    background: colors.info.bg,
    border: `1px solid ${colors.info.border}`,
    color: colors.info.fg,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: fontSizes.displayLg,
    fontWeight: fontWeights.bold,
  },
  title: {
    fontSize: fontSizes.displayLg,
    fontWeight: fontWeights.bold,
    margin: 0,
    letterSpacing: '-0.3px',
  },
  soonPill: pill('info'),
  tagline: {
    fontSize: fontSizes.xl,
    fontWeight: fontWeights.semibold,
    color: colors.info.fgSoft,
    margin: 0,
  },
  blurb: {
    fontSize: fontSizes.lg,
    color: colors.textMuted,
    lineHeight: 1.6,
    maxWidth: 440,
    margin: 0,
  },
  backBtn: {
    ...button({ variant: 'ghost' }),
    marginTop: spacing.sm,
  },
};
