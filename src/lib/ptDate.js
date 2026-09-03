// Pacific-time date helpers.
//
// The whole app operates on the America/Los_Angeles calendar (crons, Metricool,
// Google Calendar all assume PT). But `timestamptz` columns compare in UTC, so
// filtering one with a bare 'YYYY-MM-DD' string makes Postgres assume UTC
// midnight — which pulls late-PT rows from the previous day across the boundary
// (a June 30 8pm PT post counts as July). Likewise, slicing a timestamptz's ISO
// string (`.slice(0,10)`) yields its UTC calendar day, not its PT day.
//
// These helpers anchor boundaries and day/month keys to Pacific time, DST-aware
// via Intl.

// Offset (wall - utc, in ms) of America/Los_Angeles at a given UTC instant.
// PDT => +? we return e.g. -7h as a negative number.
function laOffsetMs(utcInstant) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date(utcInstant)).reduce((a, p) => { a[p.type] = p.value; return a; }, {});
  const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
  return asUTC - utcInstant;
}

// UTC instant (ISO string) for Pacific midnight of a 'YYYY-MM-DD' date.
// endExclusive=true returns midnight PT of the *following* day, for half-open
// ranges: .gte(startUtc).lt(endUtc). Month/year rollover handled by Date.UTC.
export function ptDateToUtcISO(dateStr, endExclusive = false) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d + (endExclusive ? 1 : 0), 0, 0, 0);
  return new Date(guess - laOffsetMs(guess)).toISOString();
}

// Half-open UTC range [startUtc, endUtc) covering the PT calendar span from
// `startDate` through `endDate` inclusive (both 'YYYY-MM-DD').
export function ptRangeToUtc(startDate, endDate) {
  return { startUtc: ptDateToUtcISO(startDate), endUtc: ptDateToUtcISO(endDate, true) };
}

const PT_MONTH_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit',
});
const PT_DAY_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
});

// PT calendar 'YYYY-MM' for a timestamptz/ISO value.
export function ptMonthKey(isoOrDate) {
  return PT_MONTH_FMT.format(new Date(isoOrDate));
}

// PT calendar 'YYYY-MM-DD' for a timestamptz/ISO value.
export function ptDayKey(isoOrDate) {
  return PT_DAY_FMT.format(new Date(isoOrDate));
}

// 'YYYY-MM-DD' of the Monday starting the PT week that contains this instant.
// Monday–Sunday matches getSprintWeek() in SprintBoard, so weekly goals and
// sprints share a week boundary. Arithmetic runs in UTC on the already-
// resolved PT calendar day so it can't drift back across the timezone.
export function ptWeekStartKey(isoOrDate) {
  const [y, m, d] = ptDayKey(isoOrDate).split('-').map(Number);
  const t = Date.UTC(y, m - 1, d);
  const dow = new Date(t).getUTCDay(); // 0=Sun
  return new Date(t - (dow === 0 ? 6 : dow - 1) * 86400000).toISOString().slice(0, 10);
}

// The Monday-start keys for the last `count` PT weeks, oldest first,
// ending with the current week.
export function recentWeekStarts(count, now = new Date()) {
  const current = ptWeekStartKey(now);
  const [y, m, d] = current.split('-').map(Number);
  const currentMs = Date.UTC(y, m - 1, d);
  return Array.from({ length: count }, (_, i) =>
    new Date(currentMs - (count - 1 - i) * 7 * 86400000).toISOString().slice(0, 10));
}
