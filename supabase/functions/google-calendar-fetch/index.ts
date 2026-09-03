import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Admin tier = admin + director (mirrors the DB is_admin() helper and the
// client-side isAdminTier). Directors are restricted in the UI, not here.
const ADMIN_TIER = ["admin", "director"];

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

    // Verify user is admin
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: profile } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!profile || !ADMIN_TIER.includes(profile.role)) {
      return new Response(JSON.stringify({ error: "Admin only" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { date } = await req.json();
    if (!date) {
      return new Response(JSON.stringify({ error: "date required (YYYY-MM-DD)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken = await getValidToken(adminClient, user.id);
    if (!accessToken) {
      return new Response(JSON.stringify({ events: [], reason: "no_connection" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch events for the given day from the user's primary calendar
    const timeMin = `${date}T00:00:00-08:00`;
    const timeMax = `${date}T23:59:59-08:00`;

    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: "true",
      orderBy: "startTime",
      timeZone: "America/Los_Angeles",
    });

    const calRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!calRes.ok) {
      const err = await calRes.json().catch(() => ({}));
      throw new Error(err.error?.message || `Google API error: ${calRes.status}`);
    }

    const calData = await calRes.json();

    const events = (calData.items || [])
      .filter((item: any) => item.status !== "cancelled")
      .map((item: any) => {
        const isAllDay = !!item.start?.date;
        return {
          id: item.id,
          title: item.summary || "(No title)",
          description: item.description || "",
          location: item.location || "",
          all_day: isAllDay,
          start_date: isAllDay ? `${item.start.date}T00:00:00` : item.start.dateTime,
          end_date: isAllDay ? `${item.end.date}T00:00:00` : item.end.dateTime,
          source: "google",
        };
      });

    return new Response(JSON.stringify({ events }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Fetch error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
