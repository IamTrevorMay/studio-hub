// supabase/functions/metricool-posts/index.ts
// Deploy with: supabase functions deploy metricool-posts --no-verify-jwt

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get Metricool credentials from environment
    const mcToken = Deno.env.get("METRICOOL_TOKEN");
    const mcUserId = Deno.env.get("METRICOOL_USER_ID");
    const mcBlogId = Deno.env.get("METRICOOL_BLOG_ID");

    if (!mcToken || !mcUserId || !mcBlogId) {
      return new Response(
        JSON.stringify({ error: "Metricool credentials not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse query params from the request
    const url = new URL(req.url);
    const start = url.searchParams.get("start");
    const end = url.searchParams.get("end");
    const timezone = url.searchParams.get("timezone") || "America/Los_Angeles";

    if (!start || !end) {
      return new Response(
        JSON.stringify({ error: "Missing required params: start, end" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Call Metricool API
    const mcUrl = `https://app.metricool.com/api/v2/scheduler/posts?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&timezone=${encodeURIComponent(timezone)}&extendedRange=true&userId=${mcUserId}&blogId=${mcBlogId}`;

    const mcResponse = await fetch(mcUrl, {
      method: "GET",
      headers: {
        "X-Mc-Auth": mcToken,
      },
    });

    if (!mcResponse.ok) {
      const errorText = await mcResponse.text();
      return new Response(
        JSON.stringify({ error: `Metricool API error: ${mcResponse.status}`, details: errorText }),
        { status: mcResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await mcResponse.json();

    // Transform the data to only what the frontend needs
    // This keeps the response light and avoids exposing unnecessary data
    const posts = (data.data || []).map((post) => ({
      id: post.id,
      text: post.text?.substring(0, 120) || "",
      publicationDate: post.publicationDate,
      status: post.providers?.[0]?.status || "UNKNOWN",
      network: post.providers?.[0]?.network || "unknown",
      publicUrl: post.providers?.[0]?.publicUrl || null,
      youtubeTitle: post.youtubeData?.title || null,
      youtubeType: post.youtubeData?.type || null,
      instagramType: post.instagramData?.type || null,
      facebookType: post.facebookData?.type || null,
      draft: post.draft,
      creatorEmail: post.creatorUserMail,
    }));

    return new Response(
      JSON.stringify({ posts }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
