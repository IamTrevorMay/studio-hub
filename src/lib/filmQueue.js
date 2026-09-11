// Film Queue shared vocabulary + the session packer.
//
// The packer here drives the Film Queue view's derived "next session" display.
// The 6am lock job packs server-side with the same rules — keep
// supabase/functions/shared/film-queue.ts in sync with any change here.

// Queue-eligible types. Podcast ideas are deliberately absent — they can only
// go to Projects. Colors match the seeded beat_sheet_tags hues.
export const QUEUE_TYPES = [
  { value: 'mayday', label: 'Mayday', color: '#f87171', defaultMinutes: 25 },
  { value: 'tm_baseball', label: 'TM Baseball', color: '#34d399', defaultMinutes: 25 },
  { value: 'short_form', label: 'Short Form', color: '#fbbf24', defaultMinutes: 5 },
  { value: 'ad', label: 'Ad', color: '#38bdf8', defaultMinutes: 5 },
];

export const QUEUE_TYPE_BY_VALUE = Object.fromEntries(QUEUE_TYPES.map((t) => [t.value, t]));

export function queueTypeLabel(value) {
  return QUEUE_TYPE_BY_VALUE[value]?.label || value || '—';
}

export function queueTypeColor(value) {
  return QUEUE_TYPE_BY_VALUE[value]?.color || '#8fb4d8';
}

export function defaultMinutesFor(queueType) {
  return QUEUE_TYPE_BY_VALUE[queueType]?.defaultMinutes ?? 25;
}

// Idea tags (idea_tags.label) → queue type. Same idea as Ideas.js's
// TAG_LABEL_TO_PROJECT_TYPE, but for the Film Queue path. 'Podcast Only'
// maps to nothing on purpose.
export const IDEA_TAG_TO_QUEUE_TYPE = {
  'Mayday Videos': 'mayday',
  'Trevor May Baseball Videos': 'tm_baseball',
  'Short Form Only': 'short_form',
  'Ad': 'ad',
};

// Queue type → beat_sheet_tags.label, used when the enqueue path stamps the
// created sheet with the matching beat sheet tag.
export const QUEUE_TYPE_TO_SHEET_TAG = {
  mayday: 'Mayday',
  tm_baseball: 'Trevor May Baseball',
  short_form: 'Short Form',
  ad: 'Ad Read',
};

// Beat sheet three-state status (beat_sheets.status).
export const BEAT_SHEET_STATUSES = [
  { value: 'drafting', label: 'Drafting', color: '#8fb4d8' },
  { value: 'ready_for_review', label: 'Ready for review', color: '#fbbf24' },
  { value: 'approved', label: 'Approved', color: '#22c55e' },
];
export const STATUS_BY_VALUE = Object.fromEntries(BEAT_SHEET_STATUSES.map((s) => [s.value, s]));

export const SESSION_MINUTES_LIMIT = 60;
export const SESSION_ITEM_LIMIT = 6;

// The line's order: ads float to the top, then oldest approved first.
// `items` need `queue_type`, `approved_at`, and `created_at` (tiebreak).
export function orderTheLine(items) {
  return [...(items || [])].sort((a, b) => {
    const adA = a.queue_type === 'ad' ? 0 : 1;
    const adB = b.queue_type === 'ad' ? 0 : 1;
    if (adA !== adB) return adA - adB;
    const ta = new Date(a.approved_at || a.created_at || 0).getTime();
    const tb = new Date(b.approved_at || b.created_at || 0).getTime();
    if (ta !== tb) return ta - tb;
    return String(a.id).localeCompare(String(b.id));
  });
}

// Pack the next session: fill in line order to 60 minutes and 6 items,
// whichever hits first. The fill is a strict prefix of the line — the first
// item that doesn't fit stops the pack and stays at the front of the line
// (that's the "overflow keeps its place" rule; nothing skips past it).
// A session always takes at least one item, even one longer than the limit.
// Items need `estimated_minutes` (falls back to the type default).
export function packSession(items) {
  const line = orderTheLine(items);
  const packed = [];
  let totalMinutes = 0;
  for (const item of line) {
    const minutes = Number(item.estimated_minutes) || defaultMinutesFor(item.queue_type);
    if (packed.length >= SESSION_ITEM_LIMIT) break;
    if (packed.length > 0 && totalMinutes + minutes > SESSION_MINUTES_LIMIT) break;
    packed.push(item);
    totalMinutes += minutes;
  }
  return { packed, remaining: line.slice(packed.length), totalMinutes };
}
