import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Any non-client account may push. calendar_events is readable by every
// non-client under RLS, so letting them mirror an event they can already see
// onto the team's Google calendar exposes nothing new; clients are fenced off
// calendar_events entirely and stay fenced off here.
const PT = "America/Los_Angeles";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function getValidToken(adminClient: any, userId: string) {
  const { data: conn, error } = await adminClient
    .from("google_calendar_connections")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (error || !conn) return null;

  if (new Date(conn.token_expires_at) <= new Date(Date.now() + 5 * 60 * 1000)) {
    const clientId = Deno.env.get("GOOGLE_CLIENT_ID")!;
    const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET")!;

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: conn.refresh_token,
        grant_type: "refresh_token",
      }),
    });

    const tokens = await res.json();
    if (!res.ok || !tokens.access_token) return null;

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
    await adminClient
      .from("google_calendar_connections")
      .update({
        access_token: tokens.access_token,
        token_expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    return tokens.access_token;
  }

  return conn.access_token;
}

// ── PT wall-clock helpers (mirror google-calendar-pull) ─────────────────────
// Studio is PT-pinned: all-day rows are stored as PT 00:00 → PT 23:59, and
// recurrence excludedDates / endDate are PT calendar days. Everything sent to
// Google has to be expressed on that PT wall clock, never on UTC dates.

function ptParts(d: Date): { y: number; m: number; d: number; hh: number; mm: number; ss: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: PT, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(d)) p[part.type] = part.value;
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour % 24, mm: +p.minute, ss: +p.second };
}

function ptDateKey(d: Date): string {
  const { y, m, d: day } = ptParts(d);
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function tzOffsetMs(d: Date): number {
  const { y, m, d: day, hh, mm, ss } = ptParts(d);
  return Date.UTC(y, m - 1, day, hh, mm, ss) - d.getTime();
}

/** PT wall-clock → UTC instant (two passes so DST edges resolve correctly). */
function ptWallToUtc(y: number, m: number, d: number, hh: number, mm: number, ss = 0): Date {
  const naive = Date.UTC(y, m - 1, d, hh, mm, ss);
  let off = tzOffsetMs(new Date(naive));
  off = tzOffsetMs(new Date(naive - off));
  return new Date(naive - off);
}

function shiftDateKey(key: string, days: number): string {
  const [y, m, d] = key.slice(0, 10).split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

const compact = (key: string) => key.slice(0, 10).replace(/-/g, "");

function utcStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/**
 * Studio recurrence_rule → Google `recurrence` lines (RRULE + EXDATE).
 * Mirrors src/lib/recurrence.js: daily / weekly(daysOfWeek) / weekdays /
 * monthly (same day-of-month) / yearly, ending never / on a PT date / after N.
 */
function buildRecurrence(rule: any, ev: any): string[] | null {
  if (!rule || rule.type === "none") return null;

  const parts: string[] = [];

  const freqMap: Record<string, string> = {
    daily: "DAILY",
    weekly: "WEEKLY",
    monthly: "MONTHLY",
    yearly: "YEARLY",
    weekdays: "WEEKLY",
  };

  const freq = freqMap[rule.type];
  if (!freq) return null;

  parts.push(`FREQ=${freq}`);

  if (rule.type === "weekdays") {
    parts.push("BYDAY=MO,TU,WE,TH,FR");
  } else if (rule.type === "weekly" && rule.daysOfWeek?.length) {
    const dayMap = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
    parts.push(`BYDAY=${rule.daysOfWeek.map((d: number) => dayMap[d]).join(",")}`);
  }

  if (rule.interval && rule.interval > 1) {
    parts.push(`INTERVAL=${rule.interval}`);
  }

  // UNTIL must match DTSTART's value type: a bare date for all-day series, a
  // UTC timestamp (end of that PT day) for timed ones.
  if (rule.endType === "count" && rule.endCount) {
    parts.push(`COUNT=${rule.endCount}`);
  } else if (rule.endType === "date" && rule.endDate) {
    if (ev.all_day) {
      parts.push(`UNTIL=${compact(rule.endDate)}`);
    } else {
      const [y, m, d] = rule.endDate.slice(0, 10).split("-").map(Number);
      parts.push(`UNTIL=${utcStamp(ptWallToUtc(y, m, d, 23, 59, 59))}`);
    }
  }

  const lines = [`RRULE:${parts.join(";")}`];

  // Skipped occurrences. An EXDATE has to name the instance's exact start, so
  // timed series carry the parent's PT wall-clock time on each excluded day.
  const excluded: string[] = [...new Set((rule.excludedDates || []).map((k: string) => String(k).slice(0, 10)))]
    .filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k))
    .sort();
  if (excluded.length) {
    if (ev.all_day) {
      lines.push(`EXDATE;VALUE=DATE:${excluded.map(compact).join(",")}`);
    } else {
      const { hh, mm, ss } = ptParts(new Date(ev.start_date));
      const hms = `${String(hh).padStart(2, "0")}${String(mm).padStart(2, "0")}${String(ss).padStart(2, "0")}`;
      lines.push(`EXDATE;TZID=${PT}:${excluded.map((k) => `${compact(k)}T${hms}`).join(",")}`);
    }
  }

  return lines;
}

function buildGoogleEvent(ev: any) {
  const event: any = {
    summary: ev.title,
    description: ev.description || "",
    location: ev.location || "",
  };

  if (ev.all_day) {
    const startParsed = new Date(ev.start_date);
    const endParsed = new Date(ev.end_date);
    if (isNaN(startParsed.getTime()) || isNaN(endParsed.getTime())) {
      throw new Error(`Invalid dates on event "${ev.title}": start=${ev.start_date}, end=${ev.end_date}`);
    }
    // Studio stores the last day at 23:59 PT; Google wants an exclusive end
    // date. Resolve both on the PT wall clock — the old UTC split put a 3-day
    // block on Google as 4 days.
    const startKey = ptDateKey(startParsed);
    const lastKey = ptDateKey(endParsed);
    event.start = { date: startKey };
    event.end = { date: shiftDateKey(lastKey < startKey ? startKey : lastKey, 1) };
  } else {
    if (!ev.start_date || !ev.end_date) {
      throw new Error(`Missing dates on event "${ev.title}"`);
    }
    event.start = { dateTime: ev.start_date, timeZone: PT };
    event.end = { dateTime: ev.end_date, timeZone: PT };
  }

  // PUT replaces the whole resource, so an empty list is what clears a series
  // that was made one-off in Studio.
  event.recurrence = buildRecurrence(ev.recurrence_rule, ev) ?? [];

  return event;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Clients are fenced off calendar_events by RLS; keep them out here too.
    // Everyone else (staff + contractors) can already read every event, so
    // mirroring one to Google via the team connection leaks nothing.
    {
      const roleClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      const { data: profile } = await roleClient
        .from("profiles").select("role, deactivated_at").eq("id", user.id).single();
      if (!profile || profile.role === "client" || profile.deactivated_at) {
        return new Response(JSON.stringify({ error: "Not allowed" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const { action, event_id } = await req.json();
    if (!action || !event_id) {
      return new Response(JSON.stringify({ error: "action and event_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (typeof event_id !== "string" || !/^[0-9a-fA-F-]{36}$/.test(event_id)) {
      return new Response(JSON.stringify({ error: "Invalid event_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: ev, error: evError } = await adminClient
      .from("calendar_events")
      .select("*")
      .eq("id", event_id)
      .single();

    if (evError || !ev) {
      if (action === "delete") {
        return new Response(JSON.stringify({ synced: true, action: "delete", skipped: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "Event not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Which Google connection carries this event: the caller's own if they
    // have one, otherwise whichever connection has this event type mapped —
    // that's how a teammate's Studio event lands on the shared calendar. A row
    // already on Google sticks to the calendar it was pushed to.
    let connUserId: string | null = null;
    let mapping: { google_calendar_id: string } | null = null;
    {
      const { data: own } = await adminClient
        .from("google_calendar_connections")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle();

      let q = adminClient
        .from("google_calendar_mappings")
        .select("user_id, google_calendar_id")
        .eq("event_type", ev.event_type);
      if (own) q = q.eq("user_id", own.user_id);
      const { data: candidates } = await q.order("created_at", { ascending: true });

      const pinned = (candidates || []).find((m: any) => m.google_calendar_id === ev.google_calendar_id);
      const chosen = pinned || (candidates || [])[0] || null;
      if (chosen) {
        connUserId = chosen.user_id;
        mapping = { google_calendar_id: chosen.google_calendar_id };
      }
    }

    if (!connUserId || !mapping) {
      return new Response(JSON.stringify({ synced: false, reason: "no_mapping" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken = await getValidToken(adminClient, connUserId);
    if (!accessToken) {
      return new Response(JSON.stringify({ synced: false, reason: "token_expired" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const calId = encodeURIComponent(mapping.google_calendar_id);
    const baseUrl = `https://www.googleapis.com/calendar/v3/calendars/${calId}/events`;

    if (action === "delete") {
      if (ev.google_event_id) {
        const res = await fetch(`${baseUrl}/${ev.google_event_id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok && res.status !== 404 && res.status !== 410) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error?.message || `Delete failed: ${res.status}`);
        }
      }
      return new Response(JSON.stringify({ synced: true, action: "delete" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const googleEvent = buildGoogleEvent(ev);

    if (action === "update" && ev.google_event_id) {
      const res = await fetch(`${baseUrl}/${ev.google_event_id}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(googleEvent),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `Update failed: ${res.status}`);
      }

      await adminClient
        .from("calendar_events")
        .update({
          google_calendar_id: mapping.google_calendar_id,
          google_synced_at: new Date().toISOString(),
        })
        .eq("id", event_id);

      return new Response(JSON.stringify({ synced: true, action: "update" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const res = await fetch(baseUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(googleEvent),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Create failed: ${res.status}`);
    }

    const created = await res.json();

    await adminClient
      .from("calendar_events")
      .update({
        google_event_id: created.id,
        google_calendar_id: mapping.google_calendar_id,
        google_synced_at: new Date().toISOString(),
      })
      .eq("id", event_id);

    return new Response(JSON.stringify({ synced: true, action: "create", google_event_id: created.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Sync error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
