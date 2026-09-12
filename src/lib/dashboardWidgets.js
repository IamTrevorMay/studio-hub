// Dashboard widget catalog + layout engine.
//
// The Dashboard is a 4-column grid of user-arranged widgets. Widgets keep their
// natural height (measured from the DOM), so the grid can't be plain CSS Grid —
// a spanning item there would force every widget in its row to the tallest
// one's height. Instead widgets are absolutely positioned and packed by the
// skyline algorithm in `packLayout`, which lets a short widget's neighbour
// float up underneath it the way an iOS home screen does.

export const GRID_COLS = 4;
export const GRID_GAP = 20;

// Column spans. "Large" is the full width of the grid.
export const SIZES = { s: 1, m: 2, l: 4 };
export const SIZE_LABELS = { s: 'S', m: 'M', l: 'L' };

export const SIZE_ORDER = ['s', 'm', 'l'];

/** The next size in the widget's allowlist, wrapping at the end. */
export function nextSize(spec, current) {
  const allowed = SIZE_ORDER.filter(s => spec.sizes.includes(s));
  const i = allowed.indexOf(current);
  return allowed[(i + 1) % allowed.length];
}

/** Widths are stored as column counts, so this maps back for the size picker. */
export function sizeForWidth(w) {
  if (w >= SIZES.l) return 'l';
  if (w >= SIZES.m) return 'm';
  return 's';
}

// The catalog. `sizes` is the allowlist offered in the size picker — a widget
// that reads badly at a given width simply doesn't offer it. `role` gates a
// widget out of the catalog entirely for people who can't use it; their saved
// entry is preserved regardless (see `visibleEntries`).
export const WIDGETS = [
  { key: 'profile',       label: 'Profile',            caption: 'Your name, title and pay-period hours', sizes: ['s', 'm'],      defaultSize: 'm' },
  { key: 'announcements', label: 'Announcements',      caption: 'Team announcements',                    sizes: ['s', 'm', 'l'], defaultSize: 'm' },
  { key: 'tasks',         label: 'My Tasks',           caption: 'Tasks assigned to you',                 sizes: ['s', 'm', 'l'], defaultSize: 'm' },
  { key: 'today',         label: "Today's Schedule",   caption: "Today's calendar events",               sizes: ['s', 'm'],      defaultSize: 'm' },
  { key: 'todo',          label: 'To Do',              caption: 'Personal to-do list',                   sizes: ['s', 'm'],      defaultSize: 's' },
  { key: 'team',          label: 'Team',               caption: 'Who is around and their status',        sizes: ['s', 'm', 'l'], defaultSize: 'm' },
  { key: 'checkin',       label: 'Check In',           caption: 'Daily check-in and its trend',          sizes: ['s', 'm', 'l'], defaultSize: 'm' },
  { key: 'sprint_panel',  label: 'Sprint Panel',       caption: 'Sprint goals and progress',             sizes: ['m', 'l'],      defaultSize: 'l' },
  { key: 'sprint_board',  label: 'Sprint Board',       caption: 'Your sprint board',                     sizes: ['m', 'l'],      defaultSize: 'l' },
  { key: 'sponsored',     label: 'Sponsored',          caption: 'Sponsored deliverables assigned to you', sizes: ['m', 'l'],     defaultSize: 'm', role: 'notPartner' },
  { key: 'completed',     label: 'Recently Completed', caption: 'Projects you recently finished',        sizes: ['m', 'l'],      defaultSize: 'm', role: 'notPartner' },
];

export const WIDGET_BY_KEY = Object.fromEntries(WIDGETS.map(w => [w.key, w]));

// Reproduces the pre-grid page: the old left column down x:0, the sprint stack
// (plus To Do) down x:2. Compaction turns that back into the two-column read
// people already have.
export const DEFAULT_LAYOUT = [
  { k: 'profile',       x: 0, w: 2 },
  { k: 'sprint_panel',  x: 2, w: 2 },
  { k: 'announcements', x: 0, w: 2 },
  { k: 'sprint_board',  x: 2, w: 2 },
  { k: 'tasks',         x: 0, w: 2 },
  { k: 'today',         x: 2, w: 2 },
  { k: 'todo',          x: 2, w: 2 },
  { k: 'team',          x: 0, w: 2 },
  { k: 'checkin',       x: 2, w: 2 },
  { k: 'sponsored',     x: 0, w: 2 },
  { k: 'completed',     x: 2, w: 2 },
];

// Pre-grid, four sections toggled through boolean keys on dashboard_prefs.
// `sprint` covered both sprint widgets, and `schedule` was today's key.
const LEGACY_KEYS = {
  schedule: ['today'],
  sprint: ['sprint_panel', 'sprint_board'],
  checkin: ['checkin'],
  todo: ['todo'],
};

export const LAYOUT_VERSION = 2;

/**
 * The stored layout, or one derived from the old boolean prefs the first time
 * a user lands on the new Dashboard. Returns `{ layout, migrated }` so the
 * caller knows whether it needs writing back.
 */
export function resolveLayout(prefs) {
  const stored = prefs?.layout;
  if (Array.isArray(stored)) return { layout: normalizeLayout(stored), migrated: false };

  const hidden = new Set();
  for (const [legacyKey, widgetKeys] of Object.entries(LEGACY_KEYS)) {
    if (prefs?.[legacyKey] === false) widgetKeys.forEach(k => hidden.add(k));
  }
  return {
    layout: DEFAULT_LAYOUT.filter(e => !hidden.has(e.k)),
    migrated: true,
  };
}

/** Drop unknown keys, clamp geometry, and de-duplicate. */
export function normalizeLayout(layout) {
  const seen = new Set();
  const out = [];
  for (const entry of layout || []) {
    const spec = WIDGET_BY_KEY[entry?.k];
    if (!spec || seen.has(entry.k)) continue;
    seen.add(entry.k);
    const allowed = spec.sizes.map(s => SIZES[s]);
    const w = allowed.includes(entry.w) ? entry.w : SIZES[spec.defaultSize];
    const x = Math.min(Math.max(0, entry.x | 0), GRID_COLS - w);
    out.push({ k: entry.k, x, w });
  }
  return out;
}

/**
 * Entries this person can actually render. A widget their role can't reach is
 * skipped here but deliberately left in the stored layout, so it returns to its
 * old slot if their role changes back.
 */
export function visibleEntries(layout, { isPartner }) {
  return layout.filter(e => {
    const spec = WIDGET_BY_KEY[e.k];
    if (!spec) return false;
    if (spec.role === 'notPartner' && isPartner) return false;
    return true;
  });
}

/** Catalog entries offered to this person, for the tray and Settings list. */
export function availableWidgets({ isPartner }) {
  return WIDGETS.filter(w => !(w.role === 'notPartner' && isPartner));
}

/**
 * Skyline packing. Walks the layout in order and rests each widget on the
 * lowest point clear of everything already placed in its columns — so a widget
 * beside a tall neighbour floats up rather than waiting for the row to end.
 *
 * `heights` maps widget key → measured pixel height. A widget that hasn't been
 * measured yet is treated as `fallbackHeight` so the first paint is close.
 */
export function packLayout(entries, heights, colWidth, fallbackHeight = 220) {
  const bottoms = new Array(GRID_COLS).fill(0);
  const placed = [];

  for (const entry of entries) {
    const span = Math.min(entry.w, GRID_COLS - entry.x);
    let top = 0;
    for (let c = entry.x; c < entry.x + span; c++) top = Math.max(top, bottoms[c]);

    const height = heights[entry.k] ?? fallbackHeight;
    placed.push({
      ...entry,
      top,
      left: entry.x * (colWidth + GRID_GAP),
      width: span * colWidth + (span - 1) * GRID_GAP,
      height,
    });
    for (let c = entry.x; c < entry.x + span; c++) bottoms[c] = top + height + GRID_GAP;
  }

  return { placed, totalHeight: Math.max(0, Math.max(...bottoms, 0) - GRID_GAP) };
}

/**
 * Where a drag should drop. Returns the insertion index and column for a
 * pointer at (px, py) relative to the grid, ignoring the widget being dragged.
 */
export function dropTarget(placed, draggedKey, px, py, colWidth, width) {
  const col = Math.round(px / (colWidth + GRID_GAP));
  const x = Math.min(Math.max(0, col), GRID_COLS - width);

  // Insert before the first remaining widget whose vertical midpoint is below
  // the cursor; otherwise it lands at the end.
  const others = placed.filter(p => p.k !== draggedKey);
  let index = others.length;
  for (let i = 0; i < others.length; i++) {
    const p = others[i];
    if (py < p.top + p.height / 2) { index = i; break; }
  }
  return { index, x };
}

/** Move `key` to `index` with column `x` and width `w`. */
export function moveEntry(layout, key, index, x, w) {
  const without = layout.filter(e => e.k !== key);
  const clampedX = Math.min(Math.max(0, x), GRID_COLS - w);
  const next = [...without];
  next.splice(Math.min(index, next.length), 0, { k: key, x: clampedX, w });
  return next;
}
