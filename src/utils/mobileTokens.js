// Mobile design tokens. Pair with the existing dark theme:
// base bg #0f0f1a, panel bg #12121f / #1a1a2e, accent #6366f1 / #a5b4fc.

export const mobileTokens = {
  // Tap-target floor (Apple HIG). Use for any interactive element.
  tap: 44,

  // Base font size (>= 16px prevents iOS Safari auto-zoom on input focus).
  fontBase: 16,

  font: {
    xs: 12,
    sm: 13,
    md: 14,
    base: 16,
    lg: 18,
    xl: 22,
    title: 28,
  },

  space: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    xxl: 24,
    xxxl: 32,
  },

  radius: {
    sm: 8,
    md: 10,
    lg: 14,
    xl: 20,
    pill: 999,
  },

  z: {
    topBar: 50,
    drawer: 60,
    backdrop: 70,
    sheet: 80,
    toast: 90,
  },

  topBarHeight: 56,

  // Safe-area insets via env() for iOS notch / home indicator.
  safeTop: 'env(safe-area-inset-top)',
  safeBottom: 'env(safe-area-inset-bottom)',
  safeLeft: 'env(safe-area-inset-left)',
  safeRight: 'env(safe-area-inset-right)',
};

// Convenience: a tap-friendly button style that other mobile components can spread.
export const mobileTapButton = {
  minWidth: mobileTokens.tap,
  minHeight: mobileTokens.tap,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  background: 'transparent',
  color: 'rgba(255,255,255,0.85)',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: mobileTokens.font.base,
  WebkitTapHighlightColor: 'transparent',
};
