// Reusable style factories built from tokens.
// Use these instead of hand-rolling a card / pill / input / button shape
// in every page. If a recipe is missing a variant you need, extend the
// recipe here rather than overriding in the page.

import {
  colors,
  spacing,
  radii,
  fontSizes,
  fontWeights,
  shadows,
  transitions,
} from './styleTokens';

// ─── Toning helper ─────────────────────────────────────────────

function toneFor(tone) {
  if (tone === 'success' || tone === 'positive') return colors.success;
  if (tone === 'warning' || tone === 'caution')  return colors.warning;
  if (tone === 'danger'  || tone === 'negative') return colors.danger;
  if (tone === 'info')                            return colors.info;
  return null;
}

// ─── Card ──────────────────────────────────────────────────────
//
// Variants:
//   default — raised surface w/ subtle border. Most common.
//   muted   — same shape, weaker border for nested groupings.
//   accent  — indigo glow border, for highlighted items.
//   tone(success|warning|danger|info) — colored side border for status.

export function card(variantOrOpts = 'default') {
  const opts = typeof variantOrOpts === 'string'
    ? { variant: variantOrOpts }
    : variantOrOpts;
  const { variant = 'default', tone = null } = opts;

  const base = {
    background: colors.bgRaised,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.lg,
    padding: spacing.lg,
    boxShadow: shadows.md,
    transition: transitions.normal,
  };

  if (variant === 'muted') {
    return { ...base, background: 'transparent', boxShadow: 'none' };
  }
  if (variant === 'accent') {
    return {
      ...base,
      borderColor: colors.accentBorder,
      background: colors.accentSoft,
    };
  }
  const t = toneFor(tone || variant);
  if (t) {
    return {
      ...base,
      borderLeft: `3px solid ${t.fg}`,
    };
  }
  return base;
}

// ─── Pill / Badge ──────────────────────────────────────────────
//
// pill(tone) returns inline-flex chip shape.
// badge(tone) is the smaller count-pill (e.g. nav badge).

export function pill(tone = 'default') {
  const t = toneFor(tone);
  const base = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing.xs,
    padding: `${spacing.xs}px ${spacing.md}px`,
    borderRadius: radii.pill,
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
    letterSpacing: 0.3,
    border: `1px solid ${colors.borderStrong}`,
    background: 'transparent',
    color: colors.textMuted,
    lineHeight: 1.4,
    whiteSpace: 'nowrap',
  };
  if (!t) return base;
  return {
    ...base,
    background: t.bg,
    border: `1px solid ${t.border}`,
    color: t.fg,
  };
}

export function badge(tone = 'accent') {
  const base = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 18,
    height: 18,
    padding: `0 ${spacing.xs}px`,
    borderRadius: radii.pill,
    fontSize: fontSizes.xxs,
    fontWeight: fontWeights.bold,
    background: colors.danger.fg,
    color: colors.text,
    lineHeight: 1,
  };
  const t = toneFor(tone);
  if (t) return { ...base, background: t.fg };
  if (tone === 'accent') return { ...base, background: colors.accent };
  return base;
}

// ─── Button ────────────────────────────────────────────────────
//
// Variants: primary | secondary | ghost | danger
// Sizes: sm | md (default) | lg

export function button({ variant = 'primary', size = 'md', disabled = false } = {}) {
  const sizeMap = {
    sm: { padX: spacing.md,  padY: spacing.xs, font: fontSizes.sm },
    md: { padX: spacing.lg,  padY: spacing.sm, font: fontSizes.md },
    lg: { padX: spacing.xl,  padY: spacing.md, font: fontSizes.lg },
  };
  const s = sizeMap[size] || sizeMap.md;

  const base = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    padding: `${s.padY}px ${s.padX}px`,
    borderRadius: radii.sm,
    fontSize: s.font,
    fontWeight: fontWeights.semibold,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    border: 'none',
    transition: transitions.fast,
    whiteSpace: 'nowrap',
  };

  if (variant === 'secondary') {
    return {
      ...base,
      background: colors.bgHover,
      color: colors.textMuted,
    };
  }
  if (variant === 'ghost') {
    return {
      ...base,
      background: 'transparent',
      border: `1px solid ${colors.borderStrong}`,
      color: colors.textMuted,
    };
  }
  if (variant === 'danger') {
    return { ...base, background: colors.danger.fg, color: colors.text };
  }
  return { ...base, background: colors.accent, color: colors.text };
}

// ─── Input / Textarea / Select ────────────────────────────────

export function input({ size = 'md' } = {}) {
  const sizeMap = {
    sm: { padX: spacing.sm, padY: spacing.xs, font: fontSizes.sm },
    md: { padX: spacing.md, padY: spacing.sm, font: fontSizes.md },
    lg: { padX: spacing.lg, padY: spacing.md, font: fontSizes.lg },
  };
  const s = sizeMap[size] || sizeMap.md;
  return {
    padding: `${s.padY}px ${s.padX}px`,
    background: colors.bgInput,
    border: `1px solid ${colors.borderStrong}`,
    borderRadius: radii.sm,
    color: colors.text,
    fontSize: s.font,
    fontFamily: 'inherit',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  };
}

// ─── Section header ──────────────────────────────────────────

export function sectionHeader(level = 2) {
  if (level === 1) {
    return {
      fontSize: fontSizes.xxl,
      fontWeight: fontWeights.bold,
      color: colors.text,
      margin: 0,
    };
  }
  if (level === 2) {
    return {
      fontSize: fontSizes.xl,
      fontWeight: fontWeights.semibold,
      color: colors.text,
      margin: 0,
    };
  }
  return {
    fontSize: fontSizes.xs,
    fontWeight: fontWeights.bold,
    color: colors.textSubtle,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    margin: 0,
  };
}

// ─── Modal shell ──────────────────────────────────────────────

export function modalOverlay() {
  return {
    position: 'fixed',
    inset: 0,
    background: colors.bgOverlay,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  };
}

export function modal({ width = 480 } = {}) {
  return {
    background: colors.bgModal,
    border: `1px solid ${colors.borderStrong}`,
    borderRadius: radii.xl,
    padding: spacing.xl,
    width,
    maxWidth: '90vw',
    boxShadow: shadows.modal,
    fontFamily: 'system-ui, -apple-system, sans-serif',
  };
}

// ─── Default export bundle ────────────────────────────────────

const recipes = {
  card,
  pill,
  badge,
  button,
  input,
  sectionHeader,
  modalOverlay,
  modal,
};

export default recipes;
