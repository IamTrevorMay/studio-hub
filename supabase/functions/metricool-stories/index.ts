// supabase/functions/metricool-stories/index.ts
// Deploy with: supabase functions deploy metricool-stories --no-verify-jwt
// Returns IG story counts per day for the last N days (default 7)

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

  const params = new URLSearchParams({
    userId: mcUserId,
    blogId: mcBlogId,
    from: fromStr,
    to: toStr,
  });

  const apiUrl = `https://app.metricool.com/api/v2/analytics/stories/instagram?${params}`;

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
    const stories: { postId: string; timestamp: number; date: string }[] = [];
    const dataArr = body?.data || body || [];

    for (const story of Array.isArray(dataArr) ? dataArr : [dataArr]) {
      if (!story.postId) continue;
      // timestamp is epoch ms
      const ts = story.timestamp;
      const d = ts ? new Date(ts) : null;
      const dateStr = d
        ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
        : null;
      stories.push({
        postId: story.postId,
        timestamp: ts,
        date: dateStr || "unknown",
      });
    }

    // Count stories per day
    const countsByDate: Record<string, number> = {};
    for (const s of stories) {
      countsByDate[s.date] = (countsByDate[s.date] || 0) + 1;
    }

    return jsonResponse({
      total: stories.length,
      countsByDate,
      stories,
    });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
});
