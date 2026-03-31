// supabase/functions/metricool-stories/index.ts
// Deploy with: supabase functions deploy metricool-stories --no-verify-jwt
// Returns IG story counts per day for the last N days (default 7)
// Uses the timelines API (same pattern as sync-metricool) instead of the
// deprecated /analytics/stories/instagram endpoint.

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

  // Build date range: today back N days
  const now = new Date();
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - days);

  const fromStr = from.toISOString().slice(0, 19) + "Z";
  const toStr = now.toISOString().slice(0, 19) + "Z";

  // Use the timelines API with subject=stories, metric=postsCount
  // This matches the working pattern used by sync-metricool
  const params = new URLSearchParams({
    userId: mcUserId,
    blogId: mcBlogId,
    network: "instagram",
    subject: "stories",
    metric: "postsCount",
    from: fromStr,
    to: toStr,
  });

  const apiUrl = `https://app.metricool.com/api/v2/analytics/timelines?${params}`;

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

    // Parse timelines response: { data: [{ values: [{ dateTime, value }] }] }
    const countsByDate: Record<string, number> = {};
    let total = 0;
    const dataArr = body?.data || body || [];
    for (const bucket of Array.isArray(dataArr) ? dataArr : [dataArr]) {
      const values = bucket?.values || [];
      for (const pt of values) {
        if (pt.dateTime && pt.value != null) {
          const dateStr = pt.dateTime.slice(0, 10);
          const count = Number(pt.value) || 0;
          countsByDate[dateStr] = (countsByDate[dateStr] || 0) + count;
          total += count;
        }
      }
    }

    return jsonResponse({ total, countsByDate });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
});
