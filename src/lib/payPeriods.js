// Semi-monthly pay periods: 1st–15th and 16th–end of month, 24 a year.
// Single source for Payroll (staff + contractor pay runs) and the contractor
// Hours page — the DB side (fl_retainer_windows_in_period, compute_freelancer_pay,
// the payroll reminder automation on days 1 + 16) already assumes these bounds.
//
// Payday is the day after the period closes: the 16th for the first half, the
// 1st of next month for the second.
//
// Dates are built from LOCAL calendar parts, never toISOString(): that converts
// to UTC and lands boundaries on the wrong day for UTC+ users.

export const ymd = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

function monthLabel(year, month) {
  return new Date(year, month, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

// The period for a given (year, 0-based month, half).
export function buildPayPeriod(year, month, isFirstHalf) {
  if (isFirstHalf) {
    return {
      start: ymd(year, month, 1),
      end: ymd(year, month, 15),
      payday: ymd(year, month, 16),
      label: `${monthLabel(year, month)} 1–15`,
    };
  }
  const lastDay = new Date(year, month + 1, 0).getDate();
  const ny = month === 11 ? year + 1 : year;
  const nm = month === 11 ? 0 : month + 1;
  return {
    start: ymd(year, month, 16),
    end: ymd(year, month, lastDay),
    payday: ymd(ny, nm, 1),
    label: `${monthLabel(year, month)} 16–${lastDay}`,
  };
}

// The period containing a date (defaults to now, local calendar).
export function getPayPeriodFor(date = new Date()) {
  return buildPayPeriod(date.getFullYear(), date.getMonth(), date.getDate() <= 15);
}

export function getCurrentPayPeriod() {
  return getPayPeriodFor(new Date());
}

// Step one period back from (year, month, isFirstHalf).
function previous(year, month, isFirstHalf) {
  if (isFirstHalf) {
    return month === 0 ? [year - 1, 11, false] : [year, month - 1, false];
  }
  return [year, month, true];
}

// The `count` periods BEFORE the current one, newest first.
export function getPayPeriodHistory(count = 6) {
  const now = new Date();
  let [year, month, first] = previous(now.getFullYear(), now.getMonth(), now.getDate() <= 15);
  const periods = [];
  for (let i = 0; i < count; i++) {
    periods.push(buildPayPeriod(year, month, first));
    [year, month, first] = previous(year, month, first);
  }
  return periods;
}

// The current period plus the `count - 1` before it, newest first.
export function getPayPeriods(count = 6) {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth();
  let first = now.getDate() <= 15;
  const periods = [];
  for (let i = 0; i < count; i++) {
    periods.push(buildPayPeriod(year, month, first));
    [year, month, first] = previous(year, month, first);
  }
  return periods;
}
