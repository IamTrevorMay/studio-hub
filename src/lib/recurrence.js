// Expand calendar events with recurrence_rule into concrete occurrences within
// [rangeStart, rangeEnd]. Shared by Calendar.js (desktop) and CalendarMobile.js
// so both render recurring events consistently.
//
// Non-recurring events pass through unchanged. Recurrence types: daily, weekly
// (with daysOfWeek), weekdays, monthly (skips months lacking the day), yearly.
// Series end by date (rule.endDate) or by count (rule.endType === 'count' +
// rule.endCount). Series-termination is counted from the series START, not the
// visible window, so an "ends after N" rule stops at the Nth overall occurrence.
export function expandRecurringEvents(events, rangeStart, rangeEnd) {
  const result = [];
  // Loop safety bound. Separate from a series' `endCount`: counts iteration
  // steps (incl. pre-window occurrences), so it must be large enough not to
  // truncate a long-running daily series before it reaches the visible window.
  const MAX_ITERATIONS = 20000;
  events.forEach(ev => {
    if (!ev.recurrence_rule || ev.recurrence_rule.type === 'none') {
      result.push(ev);
      return;
    }
    const rule = ev.recurrence_rule;
    const origStart = new Date(ev.start_date);
    const origEnd = new Date(ev.end_date);
    const duration = origEnd.getTime() - origStart.getTime();
    const interval = rule.interval || 1;
    const endDate = rule.endDate ? new Date(rule.endDate + 'T23:59:59') : null;
    const endCount = rule.endCount || 999;
    let count = 0;       // series occurrence number (drives endCount + ids)
    let iterations = 0;  // loop-safety counter (drives MAX_ITERATIONS)
    let cursor = new Date(origStart);

    const excludedDates = new Set((rule.excludedDates || []).map(d => d.split('T')[0]));

    function addOccurrence(d) {
      const occStart = new Date(d);
      occStart.setHours(origStart.getHours(), origStart.getMinutes(), origStart.getSeconds());
      const occEnd = new Date(occStart.getTime() + duration);
      // Series-termination checks run BEFORE the range cull so `count` reflects
      // occurrences from the series start, not just the visible window. Otherwise
      // an "ends after N" rule would render up to N occurrences in every month.
      if (endDate && occStart > endDate) return false;
      if (rule.endType === 'count' && count >= endCount) return false;
      count++;
      // Past the visible window: stop expanding (already counted toward series).
      if (occStart > rangeEnd) return false;
      // Before the window: counted, but not rendered.
      if (occEnd < rangeStart) return true;
      const dateKey = occStart.toISOString().split('T')[0];
      if (excludedDates.has(dateKey)) return true;
      result.push({
        ...ev,
        id: count === 1 && occStart.getTime() === origStart.getTime() ? ev.id : `${ev.id}_r${count}`,
        start_date: occStart.toISOString(),
        end_date: occEnd.toISOString(),
        _isRecurrenceInstance: count > 1 || occStart.getTime() !== origStart.getTime(),
        _parentId: ev.id,
      });
      return true;
    }

    const safeEnd = new Date(Math.min(rangeEnd.getTime(), endDate ? endDate.getTime() : rangeEnd.getTime()));
    safeEnd.setFullYear(safeEnd.getFullYear() + 1);

    if (rule.type === 'daily') {
      while (cursor <= safeEnd && iterations++ < MAX_ITERATIONS) {
        if (addOccurrence(cursor) === false) break;
        cursor.setDate(cursor.getDate() + interval);
      }
    } else if (rule.type === 'weekly') {
      const days = rule.daysOfWeek && rule.daysOfWeek.length > 0 ? rule.daysOfWeek : [origStart.getDay()];
      let weekCursor = new Date(cursor);
      weekCursor.setDate(weekCursor.getDate() - weekCursor.getDay());
      while (weekCursor <= safeEnd && iterations < MAX_ITERATIONS) {
        for (const dow of [...days].sort((a, b) => a - b)) {
          iterations++;
          const d = new Date(weekCursor);
          d.setDate(d.getDate() + dow);
          if (d < origStart) continue;
          if (d > safeEnd) break;
          if (addOccurrence(d) === false) break;
          if (iterations >= MAX_ITERATIONS) break;
        }
        weekCursor.setDate(weekCursor.getDate() + 7 * interval);
      }
    } else if (rule.type === 'weekdays') {
      while (cursor <= safeEnd && iterations++ < MAX_ITERATIONS) {
        const dow = cursor.getDay();
        if (dow >= 1 && dow <= 5) {
          if (addOccurrence(cursor) === false) break;
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    } else if (rule.type === 'monthly') {
      const dayOfMonth = origStart.getDate();
      while (cursor <= safeEnd && iterations++ < MAX_ITERATIONS) {
        const d = new Date(cursor.getFullYear(), cursor.getMonth(), dayOfMonth);
        if (d.getMonth() !== cursor.getMonth()) {
          cursor.setMonth(cursor.getMonth() + interval, 1);
          continue;
        }
        if (d >= origStart) {
          if (addOccurrence(d) === false) break;
        }
        cursor.setMonth(cursor.getMonth() + interval, 1);
      }
    } else if (rule.type === 'yearly') {
      while (cursor <= safeEnd && iterations++ < MAX_ITERATIONS) {
        if (cursor >= origStart) {
          if (addOccurrence(cursor) === false) break;
        }
        cursor.setFullYear(cursor.getFullYear() + interval);
      }
    }
  });
  return result;
}
