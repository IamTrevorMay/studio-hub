import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    if (!res.ok) return null;

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

function buildRRule(rule: any): string | null {
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

  if (rule.endType === "count" && rule.endCount) {
    parts.push(`COUNT=${rule.endCount}`);
  } else if (rule.endType === "date" && rule.endDate) {
    const d = rule.endDate.replace(/-/g, "");
    parts.push(`UNTIL=${d}T235959Z`);
  }

  return `RRULE:${parts.join(";")}`;
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
    const startDate = startParsed.toISOString().split("T")[0];
    endParsed.setDate(endParsed.getDate() + 1);
    const endDate = endParsed.toISOString().split("T")[0];
    event.start = { date: startDate };
    event.end = { date: endDate };
  } else {
    if (!ev.start_date || !ev.end_date) {
      throw new Error(`Missing dates on event "${ev.title}"`);
    }
    event.start = { dateTime: ev.start_date, timeZone: "America/Los_Angeles" };
    event.end = { dateTime: ev.end_date, timeZone: "America/Los_Angeles" };
  }

  const rrule = buildRRule(ev.recurrence_rule);
  if (rrule) {
    event.recurrence = [rrule];
  }

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

    const { action, event_id } = await req.json();
    if (!action || !event_id) {
      return new Response(JSON.stringify({ error: "action and event_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Use the caller's own Google connection — never an arbitrary first row.
    // Picking connections[0] previously meant any admin's sync ran through
    // whichever admin happened to have connected first.
    const { data: conn } = await adminClient
      .from("google_calendar_connections")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!conn) {
      return new Response(JSON.stringify({ synced: false, reason: "no_connection" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const connUserId = conn.user_id;

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

    const { data: mapping } = await adminClient
      .from("google_calendar_mappings")
      .select("google_calendar_id")
      .eq("user_id", connUserId)
      .eq("event_type", ev.event_type)
      .single();

    if (!mapping) {
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
