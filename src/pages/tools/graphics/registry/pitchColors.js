// Pitch color palette (mirrors Triton's components/chartConfig.ts).
// Server-side renderer (api/_lib/imagineRenderer.js) keeps its own copy
// of this map for the canvas path — the two MUST stay in sync if we add
// new pitch types. The values here are the client-side source of truth
// for Builder previews / Generator population.

export const PITCH_COLORS = {
  FF: '#ef4444', '4-Seam Fastball': '#ef4444',
  SI: '#f97316', Sinker: '#f97316',
  FC: '#f59e0b', Cutter: '#f59e0b',
  SL: '#0ea5e9', Slider: '#0ea5e9',
  ST: '#06b6d4', Sweeper: '#06b6d4',
  SV: '#0891b2', Slurve: '#0891b2',
  CH: '#10b981', Changeup: '#10b981',
  FS: '#14b8a6', Splitter: '#14b8a6',
  CU: '#a855f7', Curveball: '#a855f7',
  KC: '#8b5cf6', 'Knuckle Curve': '#8b5cf6',
  KN: '#ec4899', Knuckleball: '#ec4899',
  EP: '#6366f1', Eephus: '#6366f1',
  FA: '#ef4444', Fastball: '#ef4444',
};

export function getPitchColor(name) {
  return PITCH_COLORS[name] || '#71717a';
}
