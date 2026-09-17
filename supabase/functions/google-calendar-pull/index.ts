import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Admin tier = admin + director (mirrors the DB is_admin() helper and the
// client-side isAdminTier). Directors are restricted in the UI, not here.
const ADMIN_TIER = ["admin", "director"];

// ── google-calendar-pull ──────────────────────────────────────────────────────
// Reverse of google-calendar-sync. Reads the mapped Google calendars and applies
// changes back onto calendar_events. Rows Studio pushed are updated/deleted in
// place; a Google event with no matching Studio row is IMPORTED as a new event
// (2026-08-27 — previously those were skipped and the pull only echoed Studio's
// own writes). Imported rows carry google_event_id, so subsequent edits and
// deletions on the Google side flow through the same paths as pushed ones.
//
// Recurring series round-trip too (2026-09-17) for the subset Studio's
// recurrence_rule can express — daily / weekly / monthly / yearly with an
// interval, ending never / on a date / after N, plus excluded days. A moved or
// deleted single occurrence on the Google side becomes an excludedDates entry
// (and, for a move, a detached one-off row), matching Calendar.js's own
// "this occurrence" flows. Series Google can express but Studio can't (ordinal
// weekdays, BYSETPOS, RDATE…) are left untouched in both directions.
//
// Runs on pg_cron every 10 min with X-Cron-Secret, or on demand with an admin JWT.
// A one-time { "full": true } run backfills everything inside the lookback window;
// incremental runs only see what has changed since the stored sync token.
// ─────────────────────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PT = "America/Los_Angeles";
const VIDEO_EVENT_TYPES = ["video_post", "tmbb_video"];
// How far back a first-time (tokenless) sync looks. Incremental runs ignore this.
const FULL_SYNC_LOOKBACK_DAYS = 90;

// A calendar can be the push target for several event types (the personal
// calendar takes six of them). Imports need one type per calendar, so pick the
// most representative of whatever that calendar is mapped to.
const IMPORT_TYPE_PRIORITY = [
  "video_post", "tmbb_video", "meeting", "filming",
  "live_recording", "sponsor", "deadline", "unavailable",
];

function importEventType(mappedTypes: string[]): string {
  for (const t of IMPORT_TYPE_PRIORITY) {
    if (mappedTypes.includes(t)) return t;
  }
  return mappedTypes[0] || "meeting";
}

// ── PT wall-clock helpers ────────────────────────────────────────────────────
// The Studio calendar is PT-pinned (see CLAUDE.md / Calendar.js ptToDate), so
// all-day boundaries must land on PT midnight / 23:59, not UTC.

function tzOffsetMs(d: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: PT,
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(d)) p[part.type] = part.value;
  const asUTC = Date.UTC(
    +p.year, +p.month - 1, +p.day,
    +p.hour % 24, +p.minute, +p.second,
  );
  return asUTC - d.getTime();
}

/** PT wall-clock (y, m, d, hh, mm) → the corresponding UTC instant. */
function ptWallToUtc(y: number, m: number, d: number, hh: number, mm: number): Date {
  const naive = Date.UTC(y, m - 1, d, hh, mm, 0);
  // Two passes so DST transition days resolve to the right offset.
  let off = tzOffsetMs(new Date(naive));
  off = tzOffsetMs(new Date(naive - off));
  return new Date(naive - off);
}

function ptDateKey(d: Date): string {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: PT, year: "numeric", month: "2-digit", day: "2-digit",
  });
  return dtf.format(d); // YYYY-MM-DD
}

function ptTimeString(d: Date): string {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: PT, hour12: false, hour: "2-digit", minute: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(d)) p[part.type] = part.value;
  const hh = String(+p.hour % 24).padStart(2, "0");
  return `${hh}:${p.minute}`;
}

function parseYmd(s: string): [number, number, number] {
  // Google sends all-day bounds as a bare "YYYY-MM-DD"; slice defensively in
  // case a full timestamp ever shows up here.
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return [y, m, d];
}

/** Shift a YYYY-MM-DD by n calendar days without timezone drift. */
function shiftYmd(s: string, days: number): [number, number, number] {
  const [y, m, d] = parseYmd(s);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + days);
  return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
}

// ── Google auth ──────────────────────────────────────────────────────────────

async function getValidToken(adminClient: any, userId: string): Promise<string | null> {
  const { data: conn, error } = await adminClient
    .from("google_calendar_connections")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (error || !conn) return null;

  if (new Date(conn.token_expires_at) <= new Date(Date.now() + 5 * 60 * 1000)) {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
        client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
        refresh_token: conn.refresh_token,
        grant_type: "refresh_token",
      }),
    });

    const tokens = await res.json();
    if (!res.ok || !tokens.access_token) return null;

    await adminClient
      .from("google_calendar_connections")
      .update({
        access_token: tokens.access_token,
        token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    return tokens.access_token;
  }

  return conn.access_token;
}

// ── Google list (incremental where possible) ─────────────────────────────────

type ListResult = { items: any[]; nextSyncToken: string | null; usedFullSync: boolean };

async function listChanges(
  accessToken: string,
  calendarId: string,
  syncToken: string | null,
): Promise<ListResult> {
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;

  async function page(token: string | null, pageToken: string | null) {
    const params = new URLSearchParams({ maxResults: "250", showDeleted: "true" });
    if (token) {
      // syncToken is mutually exclusive with timeMin/orderBy — send it alone.
      params.set("syncToken", token);
    } else {
      const since = new Date(Date.now() - FULL_SYNC_LOOKBACK_DAYS * 86400_000);
      params.set("timeMin", since.toISOString());
      // Keep recurring masters intact rather than expanding them; recurring
      // events are skipped below (Studio stays authoritative for those).
      params.set("singleEvents", "false");
    }
    if (pageToken) params.set("pageToken", pageToken);

    const res = await fetch(`${base}?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return res;
  }

  async function drain(token: string | null): Promise<ListResult | "expired"> {
    const items: any[] = [];
    let pageToken: string | null = null;
    let nextSyncToken: string | null = null;

    do {
      const res = await page(token, pageToken);
      if (res.status === 410) return "expired"; // syncToken no longer valid
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `Google list failed: ${res.status}`);
      }
      const data = await res.json();
      items.push(...(data.items || []));
      pageToken = data.nextPageToken || null;
      nextSyncToken = data.nextSyncToken || nextSyncToken;
    } while (pageToken);

    return { items, nextSyncToken, usedFullSync: !token };
  }

  if (syncToken) {
    const out = await drain(syncToken);
    if (out !== "expired") return out;
    // Token aged out — fall through to a full resync.
  }
  const full = await drain(null);
  if (full === "expired") throw new Error("Full sync unexpectedly reported 410");
  return full;
}

// ── Apply one Google event onto its Studio row ───────────────────────────────

type Outcome = "created" | "updated" | "deleted" | "skipped";

/** Google start/end → Studio's PT-pinned timestamps. null when unusable. */
function resolveTimes(item: any): { allDay: boolean; startISO: string; endISO: string } | null {
  const allDay = !!item.start?.date;
  if (allDay) {
    const [sy, sm, sd] = parseYmd(item.start.date);
    // Google's all-day end date is exclusive; Studio stores the last day at 23:59 PT.
    const [ey, em, ed] = shiftYmd(item.end?.date || item.start.date, -1);
    return {
      allDay: true,
      startISO: ptWallToUtc(sy, sm, sd, 0, 0).toISOString(),
      endISO: ptWallToUtc(ey, em, ed, 23, 59).toISOString(),
    };
  }
  if (!item.start?.dateTime || !item.end?.dateTime) return null;
  return {
    allDay: false,
    startISO: new Date(item.start.dateTime).toISOString(),
    endISO: new Date(item.end.dateTime).toISOString(),
  };
}

// ── Recurrence: Google RRULE/EXDATE ↔ Studio recurrence_rule ─────────────────
// Studio's rule (src/lib/recurrence.js) is a small subset of RFC 5545:
//   { type: daily|weekly|weekdays|monthly|yearly, interval, daysOfWeek[],
//     endType: never|date|count, endDate: 'YYYY-MM-DD', endCount, excludedDates[] }
// Anything Google can express beyond that (BYSETPOS, ordinal BYDAY like 2TU,
// BYMONTHDAY lists, RDATE, several RRULEs) is left alone: null = unsupported,
// and the caller skips the item so Google stays authoritative for it.

const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/** "20260917", "20260917T170000Z", "20260917T100000" (+tzid) → PT date key. */
function icsValueToPtKey(value: string, tzid: string | null): string | null {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/);
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss, z] = m;
  if (!hh) return `${y}-${mo}-${d}`;
  if (z === "Z") return ptDateKey(new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mm, +ss)));
  if (tzid && tzid !== PT) {
    // Foreign zone: resolve the wall time in that zone, then read it in PT.
    try {
      const guess = new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mm, +ss));
      const dtf = new Intl.DateTimeFormat("en-US", {
        timeZone: tzid, hour12: false,
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
      });
      const p: Record<string, string> = {};
      for (const part of dtf.formatToParts(guess)) p[part.type] = part.value;
      const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
      return ptDateKey(new Date(guess.getTime() - (asUTC - guess.getTime())));
    } catch {
      return `${y}-${mo}-${d}`;
    }
  }
  return `${y}-${mo}-${d}`; // PT wall time (or floating) — the date is the date
}

function parseIcsLine(line: string): { name: string; params: Record<string, string>; value: string } | null {
  const idx = line.indexOf(":");
  if (idx < 0) return null;
  const [name, ...paramParts] = line.slice(0, idx).split(";");
  const params: Record<string, string> = {};
  for (const p of paramParts) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
  }
  return { name: name.toUpperCase(), params, value: line.slice(idx + 1) };
}

/**
 * Google `recurrence` lines → Studio rule. `start` is the series' first
 * occurrence (needed for the implicit weekly day and monthly/yearly checks).
 * Returns null when the series can't be represented.
 */
function parseRecurrence(lines: string[], start: Date, allDay: boolean): any | null {
  let rrule: Record<string, string> | null = null;
  const excluded = new Set<string>();

  for (const raw of lines || []) {
    const parsed = parseIcsLine(raw);
    if (!parsed) return null;
    if (parsed.name === "RRULE") {
      if (rrule) return null; // several rules — not representable
      rrule = {};
      for (const kv of parsed.value.split(";")) {
        const eq = kv.indexOf("=");
        if (eq < 0) return null;
        rrule[kv.slice(0, eq).toUpperCase()] = kv.slice(eq + 1);
      }
    } else if (parsed.name === "EXDATE") {
      const tzid = parsed.params.TZID || null;
      for (const v of parsed.value.split(",")) {
        const key = icsValueToPtKey(v.trim(), tzid);
        if (!key) return null;
        excluded.add(key);
      }
    } else if (parsed.name === "RDATE") {
      return null;
    }
    // EXRULE and anything else: ignore.
  }
  if (!rrule) return null;

  const startPt = ptParts(start);
  const startDow = new Date(Date.UTC(startPt.y, startPt.m - 1, startPt.d)).getUTCDay();

  const allowed = new Set(["FREQ", "INTERVAL", "COUNT", "UNTIL", "BYDAY", "BYMONTHDAY", "BYMONTH", "WKST"]);
  for (const k of Object.keys(rrule)) if (!allowed.has(k)) return null;

  const rule: any = {};
  const interval = rrule.INTERVAL ? parseInt(rrule.INTERVAL, 10) : 1;
  if (!Number.isFinite(interval) || interval < 1) return null;
  rule.interval = interval;

  switch (rrule.FREQ) {
    case "DAILY":
      if (rrule.BYDAY || rrule.BYMONTHDAY || rrule.BYMONTH) return null;
      rule.type = "daily";
      break;
    case "WEEKLY": {
      if (rrule.BYMONTHDAY || rrule.BYMONTH) return null;
      const days = rrule.BYDAY
        ? rrule.BYDAY.split(",").map((c) => DAY_CODES.indexOf(c.trim().toUpperCase()))
        : [startDow];
      if (days.some((d) => d < 0)) return null; // ordinal BYDAY (e.g. 2TU)
      rule.type = "weekly";
      rule.daysOfWeek = [...new Set(days)].sort((a, b) => a - b);
      break;
    }
    case "MONTHLY":
      if (rrule.BYDAY || rrule.BYMONTH) return null;
      if (rrule.BYMONTHDAY && rrule.BYMONTHDAY !== String(startPt.d)) return null;
      rule.type = "monthly";
      break;
    case "YEARLY":
      if (rrule.BYDAY || rrule.BYMONTHDAY) return null;
      if (rrule.BYMONTH && rrule.BYMONTH !== String(startPt.m)) return null;
      rule.type = "yearly";
      break;
    default:
      return null;
  }

  if (rrule.COUNT) {
    const n = parseInt(rrule.COUNT, 10);
    if (!Number.isFinite(n) || n < 1) return null;
    rule.endType = "count";
    rule.endCount = n;
  } else if (rrule.UNTIL) {
    const key = icsValueToPtKey(rrule.UNTIL, null);
    if (!key) return null;
    rule.endType = "date";
    rule.endDate = key;
  } else {
    rule.endType = "never";
  }
  void allDay;

  if (excluded.size) rule.excludedDates = [...excluded].sort();
  return rule;
}

/** Stable shape for change detection — key order and defaults normalised. */
function normaliseRule(rule: any): string {
  if (!rule || rule.type === "none") return "";
  return JSON.stringify({
    type: rule.type,
    interval: rule.interval || 1,
    daysOfWeek: rule.type === "weekly" ? [...(rule.daysOfWeek || [])].sort((a: number, b: number) => a - b) : undefined,
    endType: rule.endType || "never",
    endDate: rule.endType === "date" ? String(rule.endDate || "").slice(0, 10) : undefined,
    endCount: rule.endType === "count" ? rule.endCount : undefined,
    excludedDates: [...new Set((rule.excludedDates || []).map((k: string) => String(k).slice(0, 10)))].sort(),
  });
}

function ptParts(d: Date): { y: number; m: number; d: number; hh: number; mm: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: PT, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(d)) p[part.type] = part.value;
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour % 24, mm: +p.minute };
}

/** Add a PT date to a series' exclusions. No-op when it's already there. */
async function excludeOccurrence(
  admin: any, parent: any, dateKey: string, changePreview: any[], dryRun: boolean,
): Promise<boolean> {
  const rule = parent.recurrence_rule;
  if (!rule) return false;
  const existing = new Set((rule.excludedDates || []).map((k: string) => String(k).slice(0, 10)));
  if (existing.has(dateKey)) return false;
  const next = { ...rule, excludedDates: [...existing, dateKey].sort() };
  if (dryRun) {
    changePreview.push({ action: "exclude_occurrence", event_id: parent.id, title: parent.title, date: dateKey });
    return true;
  }
  const { error } = await admin
    .from("calendar_events")
    .update({ recurrence_rule: next })
    .eq("id", parent.id);
  if (error) throw new Error(`exclude occurrence failed: ${error.message}`);
  return true;
}

const ROW_COLUMNS = "id, title, description, location, event_type, start_date, end_date, all_day, recurrence_rule, google_calendar_id, google_synced_at";

async function applyItem(
  admin: any,
  item: any,
  calendarId: string,
  importType: string,
  ownerId: string,
  deletedSnapshots: any[],
  changePreview: any[],
  dryRun: boolean,
): Promise<Outcome> {
  const { data: row } = await admin
    .from("calendar_events")
    .select(ROW_COLUMNS)
    .eq("google_event_id", item.id)
    .maybeSingle();

  // ── Exception instance of a series (moved or deleted single occurrence) ──
  // Google keeps the master's RRULE intact and emits the changed occurrence as
  // its own item. Studio models the same thing as an excludedDates entry on
  // the parent plus (for a move) a standalone one-off event — the exact shape
  // Calendar.js writes for "edit / delete this occurrence".
  if (!row && item.recurringEventId) {
    const { data: parent } = await admin
      .from("calendar_events")
      .select(ROW_COLUMNS)
      .eq("google_event_id", item.recurringEventId)
      .maybeSingle();
    if (!parent || !parent.recurrence_rule) return "skipped";
    if (parent.google_calendar_id && parent.google_calendar_id !== calendarId) return "skipped";

    const orig = item.originalStartTime?.dateTime || item.originalStartTime?.date;
    if (!orig) return "skipped";
    const origKey = item.originalStartTime?.date
      ? String(item.originalStartTime.date).slice(0, 10)
      : ptDateKey(new Date(orig));

    const excluded = await excludeOccurrence(admin, parent, origKey, changePreview, dryRun);
    if (item.status === "cancelled") return excluded ? "updated" : "skipped";

    const times = resolveTimes(item);
    if (!times) return excluded ? "updated" : "skipped";

    const insertRow = {
      title: item.summary || parent.title || "(No title)",
      description: item.description ?? parent.description ?? "",
      location: item.location ?? parent.location ?? "",
      event_type: parent.event_type,
      all_day: times.allDay,
      start_date: times.startISO,
      end_date: times.endISO,
      created_by: ownerId,
      google_event_id: item.id,
      google_calendar_id: calendarId,
      google_synced_at: (item.updated ? new Date(item.updated) : new Date()).toISOString(),
    };
    if (dryRun) {
      changePreview.push({
        action: "detach_occurrence", parent_id: parent.id, google_event_id: item.id,
        title: insertRow.title, original: origKey, start: times.startISO, end: times.endISO,
      });
      return "created";
    }
    const { error: insErr } = await admin
      .from("calendar_events")
      .upsert(insertRow, { onConflict: "google_event_id", ignoreDuplicates: true });
    if (insErr) throw new Error(`calendar_events detach insert failed: ${insErr.message}`);
    return "created";
  }

  // ── Series master or plain event ──
  const times = item.status === "cancelled" ? null : resolveTimes(item);
  const rule = item.recurrence?.length && times
    ? parseRecurrence(item.recurrence, new Date(times.startISO), times.allDay)
    : null;
  // A series Studio can't represent stays Google-only (and, if it was pushed
  // from Studio, Studio's copy stays as-is rather than being flattened).
  if (item.recurrence?.length && times && !rule) return "skipped";

  // No Studio row yet — this event was born in Google. Import it.
  if (!row) {
    // A cancellation for something we never had is nothing to do.
    if (item.status === "cancelled") return "skipped";
    // Invitations the connected account turned down aren't on the schedule.
    const declined = (item.attendees || []).some(
      (a: any) => a.self && a.responseStatus === "declined",
    );
    if (declined) return "skipped";
    if (!times) return "skipped";

    const insertRow = {
      title: item.summary || "(No title)",
      description: item.description || "",
      location: item.location || "",
      event_type: importType,
      all_day: times.allDay,
      start_date: times.startISO,
      end_date: times.endISO,
      recurrence_rule: rule,
      created_by: ownerId,
      google_event_id: item.id,
      google_calendar_id: calendarId,
      google_synced_at: (item.updated ? new Date(item.updated) : new Date()).toISOString(),
    };

    if (dryRun) {
      changePreview.push({
        action: "create",
        google_event_id: item.id,
        calendar_id: calendarId,
        title: insertRow.title,
        event_type: importType,
        start: times.startISO,
        end: times.endISO,
        all_day: times.allDay,
        recurrence: rule,
      });
      return "created";
    }

    // onConflict on the unique index makes concurrent runs idempotent
    // instead of double-importing the same Google event.
    const { error: insErr } = await admin
      .from("calendar_events")
      .upsert(insertRow, { onConflict: "google_event_id", ignoreDuplicates: true });
    if (insErr) throw new Error(`calendar_events insert failed: ${insErr.message}`);
    return "created";
  }

  // Pushed from a different calendar than the one we're reading — ignore.
  if (row.google_calendar_id && row.google_calendar_id !== calendarId) return "skipped";

  if (item.status === "cancelled") {
    deletedSnapshots.push({ ...row, google_event_id: item.id });
    if (!dryRun) await admin.from("calendar_events").delete().eq("id", row.id);
    return "deleted";
  }

  // Echo guard: google_synced_at is stamped every time Studio pushes. If Google's
  // own updated timestamp is not newer, this change originated here — skip it so
  // a pull can never clobber a fresher Studio edit.
  const googleUpdated = item.updated ? new Date(item.updated) : null;
  const lastPush = row.google_synced_at ? new Date(row.google_synced_at) : null;
  if (googleUpdated && lastPush && googleUpdated <= lastPush) return "skipped";

  if (!times) return "skipped";
  const { allDay: isAllDay, startISO, endISO } = times;

  // Exclusions that arrived as cancelled instances live only on Studio's rule
  // (Google never folds them into the master's EXDATE), so keep them when the
  // master itself changes.
  let nextRule: any = rule;
  if (rule && row.recurrence_rule?.excludedDates?.length) {
    const merged = new Set<string>([
      ...(rule.excludedDates || []),
      ...row.recurrence_rule.excludedDates.map((k: string) => String(k).slice(0, 10)),
    ]);
    nextRule = { ...rule, excludedDates: [...merged].sort() };
  }

  const patch = {
    title: item.summary || "(No title)",
    description: item.description || "",
    location: item.location || "",
    all_day: isAllDay,
    start_date: startISO,
    end_date: endISO,
    recurrence_rule: nextRule,
    google_calendar_id: calendarId,
    // Stamp with Google's timestamp so a full resync doesn't re-apply this.
    google_synced_at: (googleUpdated || new Date()).toISOString(),
    updated_at: new Date().toISOString(),
  };

  const unchanged =
    row.title === patch.title &&
    (row.description || "") === patch.description &&
    (row.location || "") === patch.location &&
    !!row.all_day === patch.all_day &&
    new Date(row.start_date).getTime() === new Date(startISO).getTime() &&
    new Date(row.end_date).getTime() === new Date(endISO).getTime() &&
    normaliseRule(row.recurrence_rule) === normaliseRule(nextRule);

  if (unchanged) {
    // Nothing actually differs (common on a full resync) — just advance the
    // stamp so this item stops coming back as a candidate, and leave updated_at
    // alone so the row doesn't look freshly edited.
    if (!dryRun) {
      await admin
        .from("calendar_events")
        .update({ google_synced_at: patch.google_synced_at })
        .eq("id", row.id);
    }
    return "skipped";
  }

  if (dryRun) {
    changePreview.push({
      event_id: row.id,
      title_before: row.title,
      title_after: patch.title,
      start_before: row.start_date,
      start_after: startISO,
      end_before: row.end_date,
      end_after: endISO,
      recurrence_before: row.recurrence_rule,
      recurrence_after: nextRule,
    });
    return "updated";
  }

  const { error: updErr } = await admin
    .from("calendar_events")
    .update(patch)
    .eq("id", row.id);
  if (updErr) throw new Error(`calendar_events update failed: ${updErr.message}`);

  // Mirror a moved video event onto its linked project's Post Date, the same way
  // Calendar.js syncVideoEventToProject does for in-app moves.
  if (VIDEO_EVENT_TYPES.includes(row.event_type)) {
    const newStart = new Date(startISO);
    const { data: proj } = await admin
      .from("projects")
      .select("id, deadline, post_time")
      .eq("calendar_event_id", row.id)
      .maybeSingle();
    if (proj) {
      const deadline = ptDateKey(newStart);
      const postTime = ptTimeString(newStart);
      if (proj.deadline !== deadline || proj.post_time !== postTime) {
        await admin.from("projects")
          .update({ deadline, post_time: postTime })
          .eq("id", proj.id);
      }
    }
  }

  return "updated";
}

// ── Entry point ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Auth: CRON_SECRET (header or query) or strict-admin JWT, matching the rest
  // of the Google Calendar integration.
  let callerId: string | null = null;
  {
    const expected = Deno.env.get("CRON_SECRET");
    const provided = req.headers.get("x-cron-secret")
      ?? new URL(req.url).searchParams.get("secret");
    const isCron = !!expected && provided === expected;

    if (!isCron) {
      const auth = req.headers.get("Authorization");
      if (!auth?.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: { user } } = await admin.auth.getUser(auth.slice(7));
      if (!user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: profile } = await admin
        .from("profiles").select("role").eq("id", user.id).single();
      if (!ADMIN_TIER.includes(profile?.role)) {
        return new Response(JSON.stringify({ error: "Admin only" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      callerId = user.id;
    }
  }

  const body = await req.json().catch(() => ({}));
  const forceFull = body?.full === true;
  // dry_run reports exactly what would change without touching a single row —
  // including the sync token, so a real run afterwards still sees everything.
  const dryRun = body?.dry_run === true;
  // { full: true, only_recurring: true } backfills recurring series without
  // also importing every one-off event in the lookback window.
  const onlyRecurring = body?.only_recurring === true;
  // A JWT caller only ever syncs their own connection; cron sweeps all of them.
  const targetUserId: string | null = callerId ?? (body?.user_id ?? null);

  const startedAt = new Date().toISOString();
  const summary: any[] = [];
  const deletedSnapshots: any[] = [];
  const changePreview: any[] = [];
  let created = 0, updated = 0, deleted = 0, skipped = 0, failed = 0;

  try {
    let connQuery = admin.from("google_calendar_connections").select("user_id");
    if (targetUserId) connQuery = connQuery.eq("user_id", targetUserId);
    const { data: connections } = await connQuery;

    for (const conn of connections || []) {
      const userId = conn.user_id;

      const { data: mappings } = await admin
        .from("google_calendar_mappings")
        .select("google_calendar_id, event_type")
        .eq("user_id", userId);

      // calendar → every event_type that pushes to it, collapsed to one type for imports.
      const typesByCalendar = new Map<string, string[]>();
      for (const m of mappings || []) {
        const list = typesByCalendar.get(m.google_calendar_id) || [];
        list.push(m.event_type);
        typesByCalendar.set(m.google_calendar_id, list);
      }

      const calendarIds = [...typesByCalendar.keys()];
      if (!calendarIds.length) continue;

      const accessToken = await getValidToken(admin, userId);
      if (!accessToken) {
        summary.push({ user_id: userId, error: "token_unavailable" });
        failed++;
        continue;
      }

      for (const calendarId of calendarIds) {
        const { data: state } = await admin
          .from("google_calendar_sync_state")
          .select("sync_token")
          .eq("user_id", userId)
          .eq("google_calendar_id", calendarId)
          .maybeSingle();

        try {
          const { items, nextSyncToken, usedFullSync } = await listChanges(
            accessToken,
            calendarId,
            forceFull ? null : (state?.sync_token ?? null),
          );

          const importType = importEventType(typesByCalendar.get(calendarId) || []);

          // Exception instances need their series row to exist, and a batch
          // can carry both in any order — apply masters first.
          const ordered = [...items].sort(
            (a, b) => Number(!!a.recurringEventId) - Number(!!b.recurringEventId),
          );

          let calCreated = 0, calUpdated = 0, calDeleted = 0, calSkipped = 0;
          for (const item of ordered) {
            if (onlyRecurring && !item.recurrence?.length && !item.recurringEventId) {
              calSkipped++;
              continue;
            }
            const outcome = await applyItem(
              admin, item, calendarId, importType, userId,
              deletedSnapshots, changePreview, dryRun,
            );
            if (outcome === "created") calCreated++;
            else if (outcome === "updated") calUpdated++;
            else if (outcome === "deleted") calDeleted++;
            else calSkipped++;
          }

          created += calCreated;
          updated += calUpdated;
          deleted += calDeleted;
          skipped += calSkipped;

          if (!dryRun) {
            await admin.from("google_calendar_sync_state").upsert({
              user_id: userId,
              google_calendar_id: calendarId,
              sync_token: nextSyncToken ?? state?.sync_token ?? null,
              last_synced_at: new Date().toISOString(),
              last_status: "success",
              last_error: null,
              updated_at: new Date().toISOString(),
            }, { onConflict: "user_id,google_calendar_id" });
          }

          summary.push({
            user_id: userId,
            calendar_id: calendarId,
            full_sync: usedFullSync,
            seen: items.length,
            created: calCreated,
            updated: calUpdated,
            deleted: calDeleted,
            skipped: calSkipped,
            import_type: importType,
          });
        } catch (err) {
          failed++;
          console.error(`pull failed for ${userId}/${calendarId}:`, err);
          if (!dryRun) await admin.from("google_calendar_sync_state").upsert({
            user_id: userId,
            google_calendar_id: calendarId,
            sync_token: state?.sync_token ?? null,
            last_synced_at: new Date().toISOString(),
            last_status: "failed",
            last_error: String(err?.message || err).slice(0, 500),
            updated_at: new Date().toISOString(),
          }, { onConflict: "user_id,google_calendar_id" });
          summary.push({ user_id: userId, calendar_id: calendarId, error: String(err?.message || err) });
        }
      }
    }

    if (dryRun) {
      return new Response(JSON.stringify({
        ok: true, dry_run: true,
        would_create: created, would_update: updated, would_delete: deleted, skipped,
        changes: changePreview, deletions: deletedSnapshots, calendars: summary,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    await admin.from("ingestion_logs").insert({
      job_type: "google_calendar_pull",
      status: failed > 0 ? (created + updated + deleted > 0 ? "partial" : "failed") : "success",
      records_processed: created + updated + deleted + skipped,
      records_created: created,
      records_updated: updated,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      // Deleted rows are snapshotted here so a Google-side delete is recoverable.
      metadata: {
        calendars: summary,
        created_count: created,
        deleted_count: deleted,
        deleted_events: deletedSnapshots,
      },
    });

    return new Response(JSON.stringify({ ok: true, created, updated, deleted, skipped, calendars: summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("google-calendar-pull error:", err);
    await admin.from("ingestion_logs").insert({
      job_type: "google_calendar_pull",
      status: "failed",
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      error_message: String(err?.message || err).slice(0, 500),
      metadata: { calendars: summary },
    }).catch(() => {});
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
