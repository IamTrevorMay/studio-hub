// Single source of truth for design tokens.
// Import these into style objects so palette / spacing changes are global.
// New code MUST use these instead of hardcoded values (see ESLint rule
// mayday/no-style-magic-numbers and the docs at memory/planning/style-system.md).

// ─── Color palette ─────────────────────────────────────────────
//
// Base surfaces are layered blue-grays (Tableau-style opaque cards on a
// deep page). Text uses rgba(white, …) so alpha conveys hierarchy without
// picking new colors. Accent is steel-blue.
// Tones (success / warning / danger / info) come in bg/border/text triples
// so badges and pills look consistent.

export const colors = {
  // Surfaces — Tableau-style opaque layered cards on a deep blue-gray page
  bg:           '#0e1420',
  bgRaised:     '#161d2b',   // opaque card (was translucent white)
  bgHover:      '#1b2331',   // cardAlt / hover surface
  bgInput:      'rgba(255,255,255,0.04)',
  bgOverlay:    'rgba(0,0,0,0.6)',
  bgModal:      '#161d2b',

  // Borders
  border:       'rgba(255,255,255,0.08)',
  borderStrong: 'rgba(255,255,255,0.15)',
  borderFocus:  'rgba(91,143,199,0.5)',

  // Text — ink on dark, alpha conveys hierarchy
  text:         '#e7ebf2',
  textMuted:    'rgba(255,255,255,0.7)',
  textSubtle:   'rgba(255,255,255,0.48)',
  textDim:      'rgba(255,255,255,0.4)',
  textPlaceholder: 'rgba(255,255,255,0.3)',

  // Accent (steel-blue)
  accent:       '#5b8fc7',
  accentSoft:   'rgba(91,143,199,0.18)',
  accentFg:     '#8fb4d8',
  accentBorder: 'rgba(91,143,199,0.42)',
  accentBright: '#8fb4d8',   // lighter steel — bright stop in linear-gradient(135deg,accent,accentBright)
  accentDeep:   '#4a79ad',   // darker steel — gradient/hover-darken & categorical accent swatch
  accentFgSoft: '#c7d2fe',   // pale steel-lavender text (badges, subtle links)

  // Steel-blue alpha ramp — same #5b8fc7 hue at fixed opacities. Use for
  // tints, hairlines, hovers where accentSoft (0.18) isn't the right weight.
  accentA04:    'rgba(91,143,199,0.04)',
  accentA05:    'rgba(91,143,199,0.05)',
  accentA06:    'rgba(91,143,199,0.06)',
  accentA08:    'rgba(91,143,199,0.08)',
  accentA10:    'rgba(91,143,199,0.1)',
  accentA12:    'rgba(91,143,199,0.12)',
  accentA14:    'rgba(91,143,199,0.14)',
  accentA15:    'rgba(91,143,199,0.15)',
  accentA16:    'rgba(91,143,199,0.16)',
  accentA20:    'rgba(91,143,199,0.2)',
  accentA22:    'rgba(91,143,199,0.22)',
  accentA25:    'rgba(91,143,199,0.25)',
  accentA30:    'rgba(91,143,199,0.3)',
  accentA40:    'rgba(91,143,199,0.4)',
  accentA45:    'rgba(91,143,199,0.45)',
  accentA70:    'rgba(91,143,199,0.7)',
  accentA80:    'rgba(91,143,199,0.8)',

  // Neutrals / one-offs
  white:        '#ffffff',   // pure white — text/icons on a colored fill
  textBright:   '#e2e8f0',   // near-white ink, a touch brighter than `text`
  gold:         '#fbbf24',   // amber accent (stars, highlights)
  whiteA02:     'rgba(255,255,255,0.02)',   // faintest neutral tint (row/strip washes)
  whiteA03:     'rgba(255,255,255,0.03)',
  whiteA05:     'rgba(255,255,255,0.05)',
  whiteA06:     'rgba(255,255,255,0.06)',
  whiteA45:     'rgba(255,255,255,0.45)',
  blackA30:     'rgba(0,0,0,0.3)',

  // Semantic tones — each has bg / border / fg for badges & pills.
  success: {
    bg:     'rgba(34,197,94,0.15)',
    border: 'rgba(34,197,94,0.35)',
    fg:     '#22c55e',
    fgSoft: '#86efac',
  },
  // Emerald — a distinct teal-green cousin of success, used for active/paid
  // states (Deliverables) where a cooler green reads as "settled" not "new".
  emerald: {
    bg:     'rgba(16,185,129,0.15)',
    border: 'rgba(16,185,129,0.35)',
    fg:     '#10b981',
    fgSoft: '#34d399',
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
  // Violet — added for the suite launcher's per-app monogram tints (Drift),
  // where the six existing hues (steel, sky, green, teal, amber, red) run
  // out. General-purpose tone triple, same shape as the others.
  violet: {
    bg:     'rgba(139,92,246,0.15)',
    border: 'rgba(139,92,246,0.35)',
    fg:     '#8b5cf6',
    fgSoft: '#c4b5fd',
  },
  // Pink — added for the suite launcher's Gerald (Mayday Assistant) monogram
  // tint; the seven existing hues were already claimed by suite apps.
  pink: {
    bg:     'rgba(236,72,153,0.15)',
    border: 'rgba(236,72,153,0.35)',
    fg:     '#ec4899',
    fgSoft: '#f9a8d4',
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
  displayLg: 28,  // hero headlines (suite launcher, coming-soon pages); pairs with mobileTokens.font.title
};

export const fontWeights = {
  regular: 400,
  medium:  500,
  semibold: 600,
  bold:    700,
};

export const fontFamily = '"DM Sans", system-ui, -apple-system, sans-serif';

// Monospace — file paths, IDs, code-ish values (e.g. Harbor NAS paths).
export const fontFamilyMono = '"SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

// ─── Shadows ──────────────────────────────────────────────────

export const shadows = {
  sm:    '0 1px 2px rgba(0,0,0,0.35)',
  md:    '0 2px 6px rgba(0,0,0,0.35), 0 10px 28px rgba(0,0,0,0.4)',
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
  color:   'rgba(91, 143, 199,0.9)',
  outline: '2px solid rgba(91, 143, 199,0.9)',
  offset:  '2px',
  shadow:  '0 0 0 2px rgba(91, 143, 199,0.6)',
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
