// Shared design tokens matching the web app's dark theme

export const colors = {
  bg: '#0f0f1a',
  surface: '#1a1a2e',
  surfaceHover: '#222238',
  border: 'rgba(255,255,255,0.06)',
  borderLight: 'rgba(255,255,255,0.1)',

  text: '#e2e8f0',
  textSecondary: 'rgba(255,255,255,0.5)',
  textTertiary: 'rgba(255,255,255,0.3)',

  primary: '#6366f1',
  primaryLight: 'rgba(99,102,241,0.15)',
  blue: '#3b82f6',
  green: '#22c55e',
  greenLight: 'rgba(34,197,94,0.15)',
  amber: '#f59e0b',
  amberLight: 'rgba(245,158,11,0.15)',
  red: '#ef4444',
  redLight: 'rgba(239,68,68,0.15)',
  pink: '#ec4899',
  purple: '#8b5cf6',
  orange: '#f97316',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

export const radius = {
  sm: 6,
  md: 8,
  lg: 10,
  xl: 12,
  xxl: 16,
  full: 999,
};

export const fontSize = {
  xs: 11,
  sm: 12,
  md: 13,
  base: 14,
  lg: 16,
  xl: 18,
  xxl: 24,
  xxxl: 28,
};

export const fw = {
  normal: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
};

// React Navigation v7 dark theme (requires fonts property)
export const navigationTheme = {
  dark: true,
  colors: {
    primary: colors.primary,
    background: colors.bg,
    card: colors.surface,
    text: colors.text,
    border: colors.border,
    notification: colors.red,
  },
  fonts: {
    regular: { fontFamily: 'System', fontWeight: '400' },
    medium: { fontFamily: 'System', fontWeight: '500' },
    bold: { fontFamily: 'System', fontWeight: '700' },
    heavy: { fontFamily: 'System', fontWeight: '800' },
  },
};
