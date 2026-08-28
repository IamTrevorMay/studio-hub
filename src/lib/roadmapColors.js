// Per-roadmap color coordination, shared by the desktop Roadmap page and its
// mobile companion. Each roadmap owns one palette entry (`roadmaps.color`
// stores the key); its card, milestone rows, task rows and calendar pills all
// draw from that entry so a roadmap is recognizable at a glance. Rows with no
// stored key fall back to the palette by index.
import { colors } from './styleTokens';

export const ROADMAP_COLORS = [
  { key: 'steel',   label: 'Steel',   fg: colors.accent,     soft: colors.accentSoft, border: colors.accentBorder },
  { key: 'violet',  label: 'Violet',  fg: colors.violet.fg,  soft: colors.violet.bg,  border: colors.violet.border },
  { key: 'emerald', label: 'Emerald', fg: colors.emerald.fg, soft: colors.emerald.bg, border: colors.emerald.border },
  { key: 'amber',   label: 'Amber',   fg: colors.warning.fg, soft: colors.warning.bg, border: colors.warning.border },
  { key: 'red',     label: 'Red',     fg: colors.danger.fg,  soft: colors.danger.bg,  border: colors.danger.border },
  { key: 'sky',     label: 'Sky',     fg: colors.info.fg,    soft: colors.info.bg,    border: colors.info.border },
  { key: 'pink',    label: 'Pink',    fg: colors.pink.fg,    soft: colors.pink.bg,    border: colors.pink.border },
  { key: 'green',   label: 'Green',   fg: colors.success.fg, soft: colors.success.bg, border: colors.success.border },
];

export const ROADMAP_COLOR_MAP = Object.fromEntries(ROADMAP_COLORS.map(c => [c.key, c]));

export function roadmapPalette(roadmap, idx = 0) {
  return ROADMAP_COLOR_MAP[roadmap?.color] || ROADMAP_COLORS[idx % ROADMAP_COLORS.length];
}

// First palette key nobody is using yet, so new roadmaps stay distinguishable
// until the palette wraps.
export function nextRoadmapColor(roadmaps) {
  const taken = new Set(roadmaps.map(r => r.color).filter(Boolean));
  const free = ROADMAP_COLORS.find(c => !taken.has(c.key));
  return (free || ROADMAP_COLORS[roadmaps.length % ROADMAP_COLORS.length]).key;
}
