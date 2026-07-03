// supabase/functions/metricool-stories/index.ts
// Deploy with: supabase functions deploy metricool-stories --no-verify-jwt
// Returns IG story counts per day for the last N days (default 7)
// Uses the scheduler/posts endpoint and filters for instagramType=STORY

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function ptDayString(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth: admin JWT required (publicly exposed analytics for the dashboard
  // refresh-every-30s widget needs to be authenticated to avoid PII leak +
  // free hammering of upstream Metricool quota).
  {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Unauthorized" }, 401);
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return jsonResponse({ error: "Unauthorized" }, 401);
    const { data: profile } = await userClient.from("profiles").select("role").eq("id", user.id).single();
    if (profile?.role !== "admin") return jsonResponse({ error: "Admin access required" }, 403);
  }

  const mcToken = Deno.env.get("METRICOOL_TOKEN");
  const mcUserId = Deno.env.get("METRICOOL_USER_ID");
  const mcBlogId = Deno.env.get("METRICOOL_BLOG_ID");
  if (!mcToken || !mcUserId || !mcBlogId) {
    return jsonResponse({ error: "Metricool credentials not configured" }, 500);
  }

  const url = new URL(req.url);
  // Clamp days to a sane range so a large value can't blow up the Metricool window/cost.
  const days = Math.min(90, Math.max(1, parseInt(url.searchParams.get("days") || "7", 10) || 7));

  // Build date range in Pacific time (matches Metricool's response dates).
  // Boundaries are PT calendar days so they stay consistent with the
  // timezone=America/Los_Angeles request below.
  const DAY_MS = 86400000;
  const fromDay = ptDayString(new Date(Date.now() - (days + 1) * DAY_MS)); // extra day covers timezone overlap
  const toDay = ptDayString(); // today in PT

  const fromStr = `${fromDay}T00:00:00`;
  const toStr = `${toDay}T23:59:59`;

  const apiUrl = `https://app.metricool.com/api/v2/scheduler/posts?start=${encodeURIComponent(fromStr)}&end=${encodeURIComponent(toStr)}&timezone=America/Los_Angeles&extendedRange=true&userId=${mcUserId}&blogId=${mcBlogId}`;

  try {
    const resp = await fetch(apiUrl, {
      method: "GET",
      headers: { "X-Mc-Auth": mcToken },
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return jsonResponse(
        { error: `Metricool API ${resp.status}`, details: errText.substring(0, 500) },
        resp.status,
      );
    }

    const body = await resp.json();
    const arr = Array.isArray(body) ? body : body?.data || [];

    // Filter for published IG stories
    // Metricool returns two possible formats:
    //   Flat: top-level instagramType, network, status
    //   Nested: instagramData.type, providers[].network/status
    const stories = arr.filter((p: any) => {
      // Flat format (current API)
      if (p.instagramType === "STORY" && p.network === "instagram" && p.status === "PUBLISHED") {
        return true;
      }
      // Nested format (older API response)
      if (p.instagramData?.type === "STORY") {
        const igProvider = (p.providers || []).find((pr: any) => pr.network === "instagram");
        return igProvider?.status === "PUBLISHED";
      }
      return false;
    });

    // Count stories per day
    const countsByDate: Record<string, number> = {};
    for (const s of stories) {
      const dt = s.publicationDate?.dateTime;
      if (!dt) continue;
      const dateStr = dt.slice(0, 10);
      countsByDate[dateStr] = (countsByDate[dateStr] || 0) + 1;
    }

    return jsonResponse({
      total: stories.length,
      countsByDate,
    });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
});
