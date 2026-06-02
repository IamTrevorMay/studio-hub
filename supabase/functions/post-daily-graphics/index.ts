import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GRAPH_API = "https://graph.facebook.com/v19.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonRes(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Auth: cron secret or authenticated user
    const url = new URL(req.url);
    const cronSecret =
      url.searchParams.get("secret") || req.headers.get("x-cron-secret");
    const expectedSecret = Deno.env.get("CRON_SECRET");
    const authHeader = req.headers.get("Authorization");

    if (expectedSecret && cronSecret === expectedSecret) {
      // Cron invocation
    } else if (authHeader) {
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } }
      );
      const {
        data: { user },
        error: userError,
      } = await userClient.auth.getUser();
      if (userError || !user) {
        return jsonRes({ error: "Not authenticated" }, 401);
      }
    } else {
      return jsonRes({ error: "Not authorized" }, 401);
    }

    const accessToken = Deno.env.get("META_ACCESS_TOKEN");
    if (!accessToken) {
      return jsonRes({ error: "Missing META_ACCESS_TOKEN" }, 500);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get IG Business Account ID from platform_accounts
    const { data: igAccount } = await admin
      .from("platform_accounts")
      .select("external_id")
      .eq("platform", "instagram")
      .eq("is_active", true)
      .limit(1)
      .single();

    if (!igAccount?.external_id) {
      return jsonRes({ error: "No active Instagram account found in platform_accounts" }, 500);
    }
    const igUserId = igAccount.external_id;

    // Determine target date
    let targetDate: string | null = null;
    try {
      const body = await req.json();
      targetDate = body?.date || null;
    } catch {
      // No body — use latest
    }

    if (!targetDate) {
      const { data: latest } = await admin
        .from("daily_graphics")
        .select("date")
        .order("date", { ascending: false })
        .limit(1)
        .single();
      targetDate = latest?.date || null;
    }

    if (!targetDate) {
      return jsonRes({ error: "No daily graphics found" }, 404);
    }

    // Check if already posted
    const { data: existing } = await admin
      .from("daily_graphics_posts")
      .select("id")
      .eq("date", targetDate)
      .maybeSingle();

    if (existing) {
      return jsonRes({ skipped: true, reason: "already_posted", date: targetDate });
    }

    // Fetch graphics for this date
    const { data: graphics, error: gfxError } = await admin
      .from("daily_graphics")
      .select("*")
      .eq("date", targetDate)
      .order("id", { ascending: true });

    if (gfxError || !graphics || graphics.length === 0) {
      return jsonRes({ error: "No graphics for date", date: targetDate }, 404);
    }

    // Step 1: Create child media containers for each image
    const childIds: string[] = [];
    const errors: string[] = [];

    for (const g of graphics) {
      try {
        const params = new URLSearchParams({
          image_url: g.url,
          is_carousel_item: "true",
          access_token: accessToken,
        });

        const res = await fetch(`${GRAPH_API}/${igUserId}/media`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
        });

        const data = await res.json();

        if (data.id) {
          childIds.push(data.id);
        } else {
          errors.push(`${g.type}: ${JSON.stringify(data.error || data)}`);
        }
      } catch (err) {
        errors.push(`${g.type}: ${(err as Error).message}`);
      }
    }

    if (childIds.length === 0) {
      return jsonRes({ error: "Failed to create any child containers", details: errors }, 502);
    }

    // Step 2: Create carousel parent container
    const dateLabel = new Date(targetDate + "T12:00:00").toLocaleDateString(
      "en-US",
      { month: "long", day: "numeric", year: "numeric" }
    );
    const caption = `Daily Graphics — ${dateLabel}`;

    const carouselParams = new URLSearchParams({
      media_type: "CAROUSEL",
      caption,
      access_token: accessToken,
    });
    // Children must be comma-separated
    carouselParams.set("children", childIds.join(","));

    const carouselRes = await fetch(`${GRAPH_API}/${igUserId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: carouselParams.toString(),
    });

    const carouselData = await carouselRes.json();

    if (!carouselData.id) {
      return jsonRes(
        {
          error: "Failed to create carousel container",
          detail: carouselData.error || carouselData,
          child_ids: childIds,
          child_errors: errors.length > 0 ? errors : undefined,
        },
        502
      );
    }

    const carouselContainerId = carouselData.id;

    // Step 3: Publish the carousel
    const publishParams = new URLSearchParams({
      creation_id: carouselContainerId,
      access_token: accessToken,
    });

    const publishRes = await fetch(`${GRAPH_API}/${igUserId}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: publishParams.toString(),
    });

    const publishData = await publishRes.json();

    if (!publishData.id) {
      return jsonRes(
        {
          error: "Failed to publish carousel",
          detail: publishData.error || publishData,
          carousel_container_id: carouselContainerId,
        },
        502
      );
    }

    // Record successful post
    await admin.from("daily_graphics_posts").insert({
      date: targetDate,
      post_id: publishData.id,
      format_used: "instagram_graph_api",
      media_ids: childIds,
    });

    return jsonRes({
      success: true,
      date: targetDate,
      post_id: publishData.id,
      carousel_container_id: carouselContainerId,
      media_count: childIds.length,
      child_errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    return jsonRes({ error: (err as Error).message }, 500);
  }
});
