import React, { useState } from 'react';
import { colors, spacing, radii, fontSizes, fontWeights, fontFamily, shadows, transitions } from '../lib/styleTokens';
import { pill } from '../lib/styleRecipes';

// Full-screen launcher for the Mayday Studio suite. Rendered by AppLayout /
// AppLayoutMobile (staff roles only) before any sidebar chrome — this one
// responsive page serves both desktop and mobile.
//
// Apps:
//   Bridge — the classic studio hub (all existing tab routes). Entering it
//            records suite_last_app='bridge' so bare '/' returns to Bridge
//            on the next login.
//   Harbor — podcast & remote recording tool; coming-soon page at '/harbor'.
//            Deliberately never touches suite_last_app.

const APP_TINTS = {
  bridge: {
    tileBg: `linear-gradient(135deg, ${colors.accent}, ${colors.accentBright})`,
    tileFg: colors.white,
    restBorder: colors.accentBorder,
    hoverBorder: colors.accentA70,
    tagline: colors.accentFg,
  },
  harbor: {
    tileBg: colors.info.bg,
    tileFg: colors.info.fg,
    restBorder: colors.border,
    hoverBorder: colors.info.border,
    tagline: colors.info.fgSoft,
  },
};

export default function SuiteLauncher({ onOpenBridge, onOpenHarbor }) {
  return (
    <div style={styles.page}>
      <div style={styles.brand}>
        <img src="/logo.png" alt="Mayday Studio" width="44" height="44" />
        <h1 style={styles.brandTitle}>Mayday Studio</h1>
        <p style={styles.brandSub}>Choose an app</p>
      </div>

      <div style={styles.grid}>
        <AppCard
          tint="bridge"
          monogram="B"
          name="Bridge"
          tagline="Organize & build"
          description="Projects, sprints, calendar, deliverables, analytics — the team's operations hub."
          onClick={onOpenBridge}
        />
        <AppCard
          tint="harbor"
          monogram="H"
          name="Harbor"
          tagline="Podcast & remote recording"
          description="Record the show — and remote guests — in studio quality."
          comingSoon
          onClick={onOpenHarbor}
        />
      </div>

      <p style={styles.hint}>Switch apps anytime from the sidebar.</p>
    </div>
  );
}

function AppCard({ tint, monogram, name, tagline, description, comingSoon, onClick }) {
  const [hovered, setHovered] = useState(false);
  const t = APP_TINTS[tint];
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        ...styles.card,
        borderColor: hovered ? t.hoverBorder : t.restBorder,
        transform: hovered ? 'translateY(-4px)' : 'none',
        boxShadow: hovered ? shadows.lg : shadows.md,
      }}
    >
      <div style={{ ...styles.tile, background: t.tileBg, color: t.tileFg }}>{monogram}</div>
      <div style={styles.nameRow}>
        <span style={styles.name}>{name}</span>
        {comingSoon && <span style={styles.soonPill}>Coming soon</span>}
      </div>
      <div style={{ ...styles.tagline, color: t.tagline }}>{tagline}</div>
      <div style={{ ...styles.description, color: comingSoon ? colors.textSubtle : colors.textMuted }}>
        {description}
      </div>
    </button>
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
    gap: spacing.huge,
    padding: spacing.xxl,
    boxSizing: 'border-box',
  },
  brand: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: spacing.sm,
    textAlign: 'center',
  },
  brandTitle: {
    fontSize: fontSizes.displayLg,
    fontWeight: fontWeights.bold,
    color: colors.text,
    margin: 0,
    letterSpacing: '-0.3px',
  },
  brandSub: {
    fontSize: fontSizes.lg,
    color: colors.textSubtle,
    margin: 0,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 340px))',
    gap: spacing.xxl,
    justifyContent: 'center',
    width: '100%',
    maxWidth: 780,
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.xxxl,
    background: colors.bgRaised,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.xl,
    cursor: 'pointer',
    transition: transitions.normal,
    textAlign: 'left',
    fontFamily: 'inherit',
    color: colors.text,
  },
  tile: {
    width: 52,
    height: 52,
    borderRadius: radii.lg,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: fontSizes.display,
    fontWeight: fontWeights.bold,
    marginBottom: spacing.xs,
  },
  nameRow: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.md,
    flexWrap: 'wrap',
  },
  name: {
    fontSize: fontSizes.display,
    fontWeight: fontWeights.bold,
    color: colors.text,
  },
  soonPill: {
    ...pill('info'),
    fontSize: fontSizes.xs,
  },
  tagline: {
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.semibold,
  },
  description: {
    fontSize: fontSizes.md,
    lineHeight: 1.55,
  },
  hint: {
    fontSize: fontSizes.sm,
    color: colors.textDim,
    margin: 0,
    textAlign: 'center',
  },
};
