// Shared color logic for every Analytics chart. One source so a platform is
// the same color everywhere and semantic roles (positive/negative/grid/axis)
// stay consistent. Platform base colors live in PLATFORM_META (already
// contrast-corrected for the dark theme); this centralizes the accessor.

import { PLATFORM_META } from '../constants';
import { colors } from '../../../lib/styleTokens';

export function platformColor(platform) {
  return PLATFORM_META[platform]?.color || colors.textDim;
}

// Semantic chart roles — use these instead of ad-hoc hex so meaning is stable:
// green = positive/growth, red = negative, indigo = primary series.
export const viz = {
  positive: colors.success.fg,
  negative: colors.danger.fg,
  neutral:  colors.textSubtle,
  accent:   colors.accent,
  grid:     'rgba(255,255,255,0.06)',
  axis:     'rgba(255,255,255,0.30)',
  // Categorical series scale for charts that aren't platform-keyed.
  series: ['#6366f1', '#f59e0b', '#22c55e', '#ec4899', '#3b82f6', '#a855f7', '#14b8a6'],
};

// Single-hue sequential ramp (indigo) for intensity 0..1 — perceptually ordered,
// unlike a multi-hue ramp. Use for heatmaps / density.
export function sequential(t) {
  const c = Math.max(0, Math.min(1, Number(t) || 0));
  return `rgba(99,102,241,${(0.12 + c * 0.78).toFixed(3)})`;
}
