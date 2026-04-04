// supabase/functions/metricool-stories/index.ts
// Deploy with: supabase functions deploy metricool-stories --no-verify-jwt
// Returns IG story counts per day for the last N days (default 7)
// Uses the scheduler/posts endpoint and filters for instagramType=STORY

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

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

  const mcToken = Deno.env.get("METRICOOL_TOKEN");
  const mcUserId = Deno.env.get("METRICOOL_USER_ID");
  const mcBlogId = Deno.env.get("METRICOOL_BLOG_ID");
  if (!mcToken || !mcUserId || !mcBlogId) {
    return jsonResponse({ error: "Metricool credentials not configured" }, 500);
  }

  const url = new URL(req.url);
  const days = parseInt(url.searchParams.get("days") || "7", 10);

  // Build date range in Pacific time (matches Metricool's response dates)
  const now = new Date();
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - (days + 1)); // extra day to cover timezone overlap

  // Format as local-style datetime strings (no Z suffix) for Metricool
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmtDate = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T00:00:00`;
  const fmtNow = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T23:59:59`;

  const fromStr = fmtDate(from);
  const toStr = fmtNow(now);

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
