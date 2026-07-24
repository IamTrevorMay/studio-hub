import React, { useState } from 'react';
import { colors, spacing, radii, fontSizes, fontWeights, fontFamily, shadows, transitions } from '../lib/styleTokens';
import { pill } from '../lib/styleRecipes';
import { SUITE_APPS } from '../lib/suiteApps';

// Full-screen launcher for the Mayday Studio suite. Rendered by AppLayout /
// AppLayoutMobile (staff roles only) before any sidebar chrome — this one
// responsive page serves both desktop and mobile. The app roster (names,
// taglines, tints, link semantics) lives in src/lib/suiteApps.js.
//
// Every card is a REAL <a href>, so right-click / cmd-click / middle-click
// natively offer "open in new tab" for every app:
//   internal + coming-soon — plain left-click is intercepted (preventDefault)
//     for the same-tab suiteView flip via onOpenApp(app); modified clicks
//     fall through to the browser and the new tab resolves the same URL.
//   external — never intercepted: default anchor behavior IS the correct
//     same-tab navigation (Fathom adds target="_blank" — always a new tab).
//
// Only entering Bridge records suite_last_app (the layouts' onOpenApp does
// it); Harbor and the teasers deliberately never touch it.

export default function SuiteLauncher({ onOpenApp }) {
  return (
    <div style={styles.page}>
      <div style={styles.content}>
        <div style={styles.brand}>
          <img src="/logo.png" alt="Mayday Studio" width="44" height="44" />
          <h1 style={styles.brandTitle}>Mayday Studio</h1>
          <p style={styles.brandSub}>Choose an app</p>
        </div>

        <div style={styles.grid}>
          {SUITE_APPS.map((app) => (
            <AppCard key={app.key} app={app} onOpenApp={onOpenApp} />
          ))}
        </div>

        <p style={styles.hint}>Switch apps anytime from the sidebar.</p>
      </div>
    </div>
  );
}

function AppCard({ app, onOpenApp }) {
  const [hovered, setHovered] = useState(false);
  const t = app.tint;
  const comingSoon = app.kind === 'coming-soon';
  const external = app.kind === 'external';

  function handleClick(e) {
    // External apps: let the anchor do its thing (same-tab nav, or the
    // new tab that target="_blank" requests for Fathom).
    if (external) return;
    // Modified clicks (cmd/ctrl/shift/alt) and non-primary buttons belong
    // to the browser — new tab / new window on the card's real href.
    // (Middle-click is auxclick in modern browsers, but the button guard
    // costs nothing and covers UAs that still fire click for it.)
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    // Plain left-click: same-tab state flip, no full page load.
    e.preventDefault();
    onOpenApp?.(app);
  }

  return (
    <a
      href={app.href}
      {...(app.newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        ...styles.card,
        borderColor: hovered ? t.hoverBorder : t.restBorder,
        transform: hovered ? 'translateY(-4px)' : 'none',
        boxShadow: hovered ? shadows.lg : shadows.md,
      }}
    >
      <div style={{ ...styles.tile, background: t.tileBg, color: t.tileFg }}>{app.monogram}</div>
      <div style={styles.nameRow}>
        <span style={styles.name}>{app.name}</span>
        {comingSoon && <span style={styles.soonPill}>Coming soon</span>}
      </div>
      <div style={{ ...styles.tagline, color: t.tagline }}>{app.tagline}</div>
      <div style={{ ...styles.description, color: comingSoon ? colors.textSubtle : colors.textMuted }}>
        {app.description}
      </div>
      {external && app.localDefault && (
        <div style={styles.localHint}>Runs locally — start its dev server to open.</div>
      )}
    </a>
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
    padding: spacing.xxl,
    boxSizing: 'border-box',
    overflowY: 'auto',
  },
  // margin:auto centers vertically when the roster fits the viewport and
  // degrades to normal scroll when 7 cards overflow a short window —
  // justifyContent:'center' would clip the top instead.
  content: {
    margin: 'auto',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: spacing.huge,
    width: '100%',
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
  // 7 cards: ~4 per row on wide desktops, 2-3 on laptops, 1 on phones.
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 340px))',
    gap: spacing.xxl,
    justifyContent: 'center',
    width: '100%',
    maxWidth: 1432, // 4 × 340px cards + 3 × 24px gaps
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
    textDecoration: 'none',
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
    ...pill('default'),
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
  localHint: {
    fontSize: fontSizes.xs,
    color: colors.textDim,
    marginTop: spacing.xs,
  },
};
