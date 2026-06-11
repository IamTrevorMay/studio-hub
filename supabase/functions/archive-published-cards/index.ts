// archive-published-cards
// Weekly cron. Archives Publish-column cards whose updated_at falls before
// the START of the current PT week. A card published anytime Mon-Sun stays
// visible through that week; the following Monday it archives.
//
// Auth: x-cron-secret header OR ?secret= query param, matching CRON_SECRET.
// Schedule (UTC): every Monday at 08:00 (= Monday 00:00 PST / 01:00 PDT).
// Deploy: supabase functions deploy archive-published-cards --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-cron-secret, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResp(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getAdminClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

// Start of the current week in America/Los_Angeles, returned as a UTC ISO timestamp.
// Week boundary = Monday 00:00:00 LA-local time.
function startOfCurrentWeekPTUtc(now: Date): string {
  // Format `now` as parts in America/Los_Angeles.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false, weekday: "short",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]),
  );
  const weekdayMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const wd = weekdayMap[parts.weekday] || 1;
  const daysSinceMonday = wd - 1;

  // Build a UTC date that represents Monday 00:00:00 LA wall-clock.
  // Strategy: take "now" in LA, subtract daysSinceMonday days + current hours/mins/secs, get back to Monday 00:00 LA.
  const y = parts.year;
  const m = parts.month;
  const d = parts.day;
  const h = parts.hour === "24" ? "00" : parts.hour;
  const mi = parts.minute;
  const se = parts.second;
  // Reconstruct "now" as if it were UTC, then subtract elapsed time of week to land on Monday 00:00.
  const nowLAasUTC = new Date(`${y}-${m}-${d}T${h}:${mi}:${se}Z`);
  const startLAasUTC = new Date(
    nowLAasUTC.getTime()
      - daysSinceMonday * 86_400_000
      - Number(h) * 3_600_000
      - Number(mi) * 60_000
      - Number(se) * 1_000,
  );
  // Now convert LA-wall to real UTC: LA offset from UTC for that moment.
  // Compute by formatting startLAasUTC again in LA tz and diffing.
  const trueUtcFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    timeZoneName: "shortOffset",
  });
  const offsetPart = trueUtcFmt.formatToParts(startLAasUTC).find((p) => p.type === "timeZoneName")?.value || "GMT-8";
  const match = offsetPart.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
  let offsetMinutes = -480;
  if (match) {
    const sign = match[1] === "+" ? 1 : -1;
    const hh = Number(match[2]);
    const mm = Number(match[3] || 0);
    offsetMinutes = sign * (hh * 60 + mm);
  }
  // LA-local 00:00 = UTC time = local minus offset.
  const actualStartUtc = new Date(startLAasUTC.getTime() - offsetMinutes * 60_000);
  return actualStartUtc.toISOString();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResp({ error: "Method not allowed" }, 405);

  // Auth via CRON_SECRET.
  const url = new URL(req.url);
  const provided = req.headers.get("x-cron-secret") || url.searchParams.get("secret");
  const expected = Deno.env.get("CRON_SECRET");
  if (!expected || provided !== expected) {
    return jsonResp({ error: "Unauthorized" }, 401);
  }

  const admin = getAdminClient();
  const cutoffIso = startOfCurrentWeekPTUtc(new Date());

  // Find candidates: typed projects, status=publish, not yet archived, updated before this PT week.
  const { data: candidates, error: selectErr } = await admin
    .from("projects")
    .select("id, name, updated_at")
    .eq("status", "publish")
    .is("archived_at", null)
    .not("type", "is", null)
    .lt("updated_at", cutoffIso);

  if (selectErr) {
    return jsonResp({ error: `Select failed: ${selectErr.message}` }, 500);
  }

  if (!candidates || candidates.length === 0) {
    return jsonResp({ cutoff: cutoffIso, archived: 0, ids: [] });
  }

  const ids = candidates.map((c) => c.id);
  const nowIso = new Date().toISOString();
  const { error: updErr } = await admin
    .from("projects")
    .update({ archived_at: nowIso })
    .in("id", ids);

  if (updErr) {
    return jsonResp({ error: `Update failed: ${updErr.message}` }, 500);
  }

  return jsonResp({ cutoff: cutoffIso, archived: ids.length, ids });
});
