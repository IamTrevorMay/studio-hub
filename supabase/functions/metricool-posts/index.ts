// supabase/functions/metricool-posts/index.ts
// Deploy with: supabase functions deploy metricool-posts --no-verify-jwt

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkRateLimit } from "../shared/utils.ts";

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

  // Auth: admin JWT required (response includes creatorEmail PII).
  let _authedUserId: string;
  {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: profile } = await userClient.from("profiles").select("role").eq("id", user.id).single();
    if (profile?.role !== "admin") {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    _authedUserId = user.id;
  }

  // Rate limit: 30 requests per hour per user
  {
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { allowed, remaining } = await checkRateLimit(
      adminClient, "metricool-posts", _authedUserId, 30, 3600000
    );
    if (!allowed) {
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded. Try again later." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json", "X-RateLimit-Remaining": "0" } }
      );
    }
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

    // Metricool expects ISO datetime strings, not bare dates
    const startDt = start.includes("T") ? start : `${start}T00:00:00`;
    const endDt = end.includes("T") ? end : `${end}T23:59:59`;

    // Call Metricool API
    const mcUrl = `https://app.metricool.com/api/v2/scheduler/posts?start=${encodeURIComponent(startDt)}&end=${encodeURIComponent(endDt)}&timezone=${encodeURIComponent(timezone)}&extendedRange=true&userId=${mcUserId}&blogId=${mcBlogId}`;

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

    // Metricool returns publicationDate as { dateTime, timezone } and network
    // names in lowercase. Normalize both so callers can treat them as plain
    // strings and match the uppercase column constants in Tracking.
    const posts = (data.data || []).map((post) => {
      const pubRaw = post.publicationDate;
      const publicationDate = typeof pubRaw === "string" ? pubRaw : (pubRaw?.dateTime || null);
      const provider = post.providers?.[0] || {};
      return {
        id: post.id,
        text: post.text?.substring(0, 120) || "",
        publicationDate,
        status: (provider.status || "UNKNOWN").toUpperCase(),
        network: (provider.network || "unknown").toUpperCase(),
        publicUrl: provider.publicUrl || null,
        youtubeTitle: post.youtubeData?.title || null,
        youtubeType: post.youtubeData?.type || null,
        instagramType: post.instagramData?.type || null,
        facebookType: post.facebookData?.type || null,
        draft: post.draft,
        creatorEmail: post.creatorUserMail,
      };
    });

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
