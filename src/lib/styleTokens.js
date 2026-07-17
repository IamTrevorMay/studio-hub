// Single source of truth for design tokens.
// Import these into style objects so palette / spacing changes are global.
// New code MUST use these instead of hardcoded values (see ESLint rule
// mayday/no-style-magic-numbers and the docs at memory/planning/style-system.md).

// ─── Color palette ─────────────────────────────────────────────
//
// Base surfaces are layered dark blues. Text uses rgba(white, …) so
// alpha conveys hierarchy without picking new colors. Accent is indigo.
// Tones (success / warning / danger / info) come in bg/border/text triples
// so badges and pills look consistent.

export const colors = {
  // Surfaces
  bg:           '#0f0f1a',
  bgRaised:     'rgba(255,255,255,0.04)',
  bgHover:      'rgba(255,255,255,0.06)',
  bgInput:      'rgba(255,255,255,0.04)',
  bgOverlay:    'rgba(0,0,0,0.6)',
  bgModal:      '#15151f',

  // Borders
  border:       'rgba(255,255,255,0.06)',
  borderStrong: 'rgba(255,255,255,0.12)',
  borderFocus:  'rgba(99,102,241,0.5)',

  // Text
  text:         '#ffffff',
  textMuted:    'rgba(255,255,255,0.7)',
  textSubtle:   'rgba(255,255,255,0.5)',
  textDim:      'rgba(255,255,255,0.4)',
  textPlaceholder: 'rgba(255,255,255,0.3)',

  // Accent (indigo)
  accent:       '#6366f1',
  accentSoft:   'rgba(99,102,241,0.15)',
  accentFg:     '#a5b4fc',
  accentBorder: 'rgba(99,102,241,0.35)',

  // Semantic tones — each has bg / border / fg for badges & pills.
  success: {
    bg:     'rgba(34,197,94,0.15)',
    border: 'rgba(34,197,94,0.35)',
    fg:     '#22c55e',
    fgSoft: '#86efac',
  },
  warning: {
    bg:     'rgba(234,179,8,0.15)',
    border: 'rgba(234,179,8,0.35)',
    fg:     '#eab308',
    fgSoft: '#fde68a',
  },
  danger: {
    bg:     'rgba(239,68,68,0.15)',
    border: 'rgba(239,68,68,0.35)',
    fg:     '#ef4444',
    fgSoft: '#fca5a5',
  },
  info: {
    bg:     'rgba(56,189,248,0.15)',
    border: 'rgba(56,189,248,0.35)',
    fg:     '#38bdf8',
    fgSoft: '#7dd3fc',
  },
};

// ─── Spacing scale ─────────────────────────────────────────────
//
// 4-px base. Use these for padding, margin, gap. Do not pick 5, 7, 9,
// etc. — if the design genuinely needs an off-scale value, add it here
// with a reason in the doc.

export const spacing = {
  xs:  4,
  sm:  8,
  md:  12,
  lg:  16,
  xl:  20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
};

// ─── Border radii ──────────────────────────────────────────────

export const radii = {
  xs: 4,
  sm: 6,
  md: 8,
  lg: 10,
  xl: 14,
  pill: 999,
  circle: '50%',
};

// ─── Type ramp ────────────────────────────────────────────────

export const fontSizes = {
  xxs: 10,   // tiny labels, dot indicators
  xs:  11,   // section labels, metadata
  sm:  12,   // secondary text
  md:  13,   // body default
  lg:  14,   // emphasized body, card titles
  xl:  16,   // page subsections
  xxl: 18,   // page titles
  display: 22,
};

export const fontWeights = {
  regular: 400,
  medium:  500,
  semibold: 600,
  bold:    700,
};

export const fontFamily = '"DM Sans", system-ui, -apple-system, sans-serif';

// ─── Shadows ──────────────────────────────────────────────────

export const shadows = {
  sm:    '0 1px 2px rgba(0,0,0,0.2)',
  md:    '0 4px 14px rgba(0,0,0,0.25)',
  lg:    '0 10px 32px rgba(0,0,0,0.55)',
  modal: '0 20px 60px rgba(0,0,0,0.6)',
  inset: '0 1px 0 rgba(255,255,255,0.04) inset',
};

// ─── Focus ring (a11y) ────────────────────────────────────────
//
// Applied globally via `*:focus-visible` in App.js. The `!important`
// there overrides the many inline `outline:'none'` declarations so
// keyboard users always get a visible ring, while mouse users don't
// (that's what :focus-visible buys us). `shadow` is for custom
// widgets that need an inline ring on a non-focusable wrapper.

export const focusRing = {
  color:   'rgba(99,102,241,0.9)',
  outline: '2px solid rgba(99,102,241,0.9)',
  offset:  '2px',
  shadow:  '0 0 0 2px rgba(99,102,241,0.6)',
};

// ─── Motion ───────────────────────────────────────────────────

export const transitions = {
  fast:   'all 120ms ease-out',
  normal: 'all 200ms ease-out',
  slow:   'all 320ms ease-out',
};

// ─── Z-index ──────────────────────────────────────────────────

export const zIndex = {
  base:    1,
  dropdown: 100,
  popover:  200,
  toast:    900,
  modal:    1000,
};

// ─── Re-export everything as a single token bag for ergonomics ─

const tokens = {
  colors,
  spacing,
  radii,
  fontSizes,
  fontWeights,
  fontFamily,
  shadows,
  focusRing,
  transitions,
  zIndex,
};

export default tokens;
