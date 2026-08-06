// Pacific Time helpers for the calendar surfaces.
//
// The studio calendar is a shared, single-timezone artifact: a 3pm event is
// 3pm Pacific for everyone looking at it. Rendering it in the viewer's device
// timezone made the same event land on different days for teammates abroad (or
// with a misconfigured phone clock), so every calendar view pins to PT.
//
// Extracted from Calendar.js so the mobile calendar can't drift from desktop.

export const PT_TZ = 'America/Los_Angeles';

const _ptFull = new Intl.DateTimeFormat('en-US', {
  timeZone: PT_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});

export function getPTparts(d) {
  const p = {};
  _ptFull.formatToParts(d).forEach(({ type, value }) => {
    if (type === 'year') p.year = +value;
    else if (type === 'month') p.month = +value;
    else if (type === 'day') p.day = +value;
    else if (type === 'hour') p.hour = +value % 24;   // midnight = 24 → 0
    else if (type === 'minute') p.minute = +value;
    else if (type === 'second') p.second = +value;
  });
  return p;
}

/** 'YYYY-MM-DD' for the PT calendar day containing this instant. */
export function toPTDateKey(d) {
  const { year, month, day } = getPTparts(d);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function getPTMinutesSinceMidnight(d) {
  const { hour, minute } = getPTparts(d);
  return hour * 60 + minute;
}

export function formatPTTime(d) {
  return d.toLocaleTimeString('en-US', { timeZone: PT_TZ, hour: 'numeric', minute: '2-digit' });
}

export function toPTTimeString(d) {
  const { hour, minute } = getPTparts(d);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** Build a UTC Date from a date string + time string interpreted as Pacific Time */
export function ptToDate(dateStr, timeStr) {
  // Create a guess in UTC, then adjust by the PT offset on that instant.
  const [y, mo, da] = dateStr.split('-').map(Number);
  const [h, mi] = timeStr.split(':').map(Number);
  const guess = new Date(Date.UTC(y, mo - 1, da, h, mi, 0));
  // Determine PT offset at the guess instant
  const pts = getPTparts(guess);
  const guessLocalMin = pts.hour * 60 + pts.minute;
  const guessUTCMin = guess.getUTCHours() * 60 + guess.getUTCMinutes();
  let offsetMin = guessUTCMin - guessLocalMin;
  // Handle day-boundary wrap
  if (offsetMin > 720) offsetMin -= 1440;
  if (offsetMin < -720) offsetMin += 1440;
  const result = new Date(Date.UTC(y, mo - 1, da, h, mi, 0));
  result.setUTCMinutes(result.getUTCMinutes() + offsetMin);
  // Re-check: if the offset changed (DST boundary), adjust once more
  const check = getPTparts(result);
  if (check.hour !== h || check.minute !== mi) {
    const pts2 = getPTparts(result);
    const localMin2 = pts2.hour * 60 + pts2.minute;
    const utcMin2 = result.getUTCHours() * 60 + result.getUTCMinutes();
    let off2 = utcMin2 - localMin2;
    if (off2 > 720) off2 -= 1440;
    if (off2 < -720) off2 += 1440;
    const result2 = new Date(Date.UTC(y, mo - 1, da, h, mi, 0));
    result2.setUTCMinutes(result2.getUTCMinutes() + off2);
    return result2;
  }
  return result;
}

export function getPTDayOfWeek(d) {
  const ptStr = d.toLocaleDateString('en-US', { timeZone: PT_TZ, weekday: 'short' });
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[ptStr] ?? 0;
}

// ─── PT day anchors ────────────────────────────────────────────────────────
// A "PT day" is represented as a Date at 12:00 UTC on that calendar date.
// Noon keeps the date stable under every real-world UTC offset, so day
// arithmetic (add/subtract days) never trips over a DST boundary the way
// setHours(0,0,0,0) on a local Date does.

/** Anchor Date for the PT day containing `d` (or for a 'YYYY-MM-DD' key). */
export function ptDayAnchor(d) {
  const key = typeof d === 'string' ? d : toPTDateKey(d);
  const [y, m, day] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day, 12));
}

/** Anchor for today in PT. */
export function ptToday() {
  return ptDayAnchor(new Date());
}

/** 'YYYY-MM-DD' for an anchor (read back from UTC parts, not local ones). */
export function anchorKey(anchor) {
  const y = anchor.getUTCFullYear();
  const m = String(anchor.getUTCMonth() + 1).padStart(2, '0');
  const d = String(anchor.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(anchor, n) {
  const x = new Date(anchor);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

export function addMonths(anchor, n) {
  const x = new Date(anchor);
  x.setUTCMonth(x.getUTCMonth() + n);
  return x;
}

/** Whole days between two anchors (b - a). */
export function daysBetween(a, b) {
  return Math.round((b - a) / 86400000);
}

/** Format an anchor's date parts. Reads UTC parts, so pass timeZone: 'UTC'. */
export function formatAnchor(anchor, opts) {
  return anchor.toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
}
