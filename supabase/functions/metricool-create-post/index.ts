import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // Verify JWT and get user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify the JWT token
    const token = authHeader.replace("Bearer ", "");
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: authError } = await anonClient.auth.getUser(token);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check permissions
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role, posting_allowed")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return new Response(JSON.stringify({ error: "Profile not found" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (profile.role !== "admin" && !profile.posting_allowed) {
      return new Response(JSON.stringify({ error: "Not authorized to post" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse request body
    const { text, networks, scheduledDate, scheduledTimezone, mediaUrl } = await req.json();

    if (!text || !networks || !Array.isArray(networks) || networks.length === 0) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: text, networks" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build Metricool request
    const mcToken = Deno.env.get("METRICOOL_TOKEN");
    const mcUserId = Deno.env.get("METRICOOL_USER_ID");
    const mcBlogId = Deno.env.get("METRICOOL_BLOG_ID");

    if (!mcToken || !mcUserId || !mcBlogId) {
      return new Response(
        JSON.stringify({ error: "Metricool credentials not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // If an image URL is provided, normalize it via Metricool to get a mediaId
    let mediaId: string | null = null;
    if (mediaUrl) {
      const normalizeRes = await fetch(
        `https://app.metricool.com/api/actions/normalize/image/url?url=${encodeURIComponent(mediaUrl)}`,
        { headers: { "X-Mc-Auth": mcToken } }
      );
      if (!normalizeRes.ok) {
        const errText = await normalizeRes.text();
        return new Response(
          JSON.stringify({ error: `Image normalize failed: ${normalizeRes.status}`, details: errText }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const normalizeData = await normalizeRes.json();
      mediaId = normalizeData.mediaId || normalizeData.data?.mediaId || normalizeData.id || null;
      if (!mediaId) {
        console.warn("Image normalization returned no mediaId, post will be created without image");
      }
    }

    const mcBody: Record<string, unknown> = {
      text,
      providers: networks.map((network: string) => ({ network })),
      blogId: mcBlogId,
      userId: mcUserId,
    };

    if (scheduledDate) {
      mcBody.publicationDate = {
        dateTime: scheduledDate,
        timezone: scheduledTimezone || "America/Los_Angeles",
      };
    }

    if (mediaId) {
      mcBody.media = { mediaId };
    }

    const mcResponse = await fetch(
      "https://app.metricool.com/api/v2/scheduler/posts",
      {
        method: "POST",
        headers: {
          "X-Mc-Auth": mcToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(mcBody),
      }
    );

    if (!mcResponse.ok) {
      const errorText = await mcResponse.text();
      return new Response(
        JSON.stringify({ error: `Metricool API error: ${mcResponse.status}`, details: errorText }),
        { status: mcResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await mcResponse.json();

    return new Response(
      JSON.stringify({ success: true, id: result.data?.id || result.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
