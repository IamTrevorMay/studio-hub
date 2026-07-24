import React from 'react';
import { colors, spacing, radii, fontSizes, fontWeights, fontFamily } from '../lib/styleTokens';
import { pill, button } from '../lib/styleRecipes';

// Generic branded coming-soon teaser for suite apps that only have a route so
// far (Anchor at '/anchor', Radar at '/radar'). Parameterized by the app's
// registry entry from src/lib/suiteApps.js — monogram tile in the app's tint,
// name, tagline, one-line blurb, back to launcher. Rendered full-screen by
// AppLayout / AppLayoutMobile (staff only).
//
// These routes deliberately never write suite_last_app — the layouts only
// record it when Bridge chrome renders — so nobody gets stranded on a teaser
// page at next login (same rule Harbor's old stub followed).
export default function SuiteComingSoon({ app, onBackToLauncher }) {
  const t = app.tint;
  return (
    <div style={styles.page}>
      <div style={{ ...styles.tile, background: t.tileBg, border: `1px solid ${t.hoverBorder}`, color: t.tileFg }}>
        {app.monogram}
      </div>
      <h1 style={styles.title}>{app.name}</h1>
      <span style={styles.soonPill}>Coming soon</span>
      <p style={{ ...styles.tagline, color: t.tagline }}>{app.tagline}</p>
      <p style={styles.blurb}>{app.description}</p>
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
  soonPill: pill('default'),
  tagline: {
    fontSize: fontSizes.xl,
    fontWeight: fontWeights.semibold,
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
