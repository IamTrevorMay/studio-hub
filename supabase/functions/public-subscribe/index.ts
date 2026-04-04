// supabase/functions/public-subscribe/index.ts
// Deploy with: supabase functions deploy public-subscribe --no-verify-jwt
// Public endpoint for newsletter signup — no auth required.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResp(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResp({ error: "Method not allowed" }, 405);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResp({ error: "Invalid JSON body" }, 400);
  }

  const email = (body.email || "").trim().toLowerCase();
  const name = (body.name || "").trim() || null;
  const reportConfigId = body.report_config_id || null;

  // Validate email
  if (!email || !EMAIL_REGEX.test(email)) {
    return jsonResp({ error: "Please enter a valid email address" }, 400);
  }

  // Use service role key to bypass RLS
  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // If report_config_id provided, verify it exists and is enabled
  if (reportConfigId) {
    const { data: config } = await adminClient
      .from("report_configs")
      .select("id")
      .eq("id", reportConfigId)
      .eq("enabled", true)
      .single();

    if (!config) {
      return jsonResp({ error: "Report not found" }, 404);
    }
  }

  // Check for existing subscription
  let query = adminClient
    .from("newsletter_subscribers")
    .select("id, unsubscribed_at")
    .eq("email", email);

  if (reportConfigId) {
    query = query.eq("report_config_id", reportConfigId);
  } else {
    query = query.is("report_config_id", null);
  }

  const { data: existing } = await query.maybeSingle();

  if (existing && !existing.unsubscribed_at) {
    return jsonResp({ error: "You're already subscribed!", alreadySubscribed: true }, 409);
  }

  // Re-subscribe if previously unsubscribed
  if (existing && existing.unsubscribed_at) {
    const { error } = await adminClient
      .from("newsletter_subscribers")
      .update({ unsubscribed_at: null, confirmed: true, name })
      .eq("id", existing.id);

    if (error) {
      return jsonResp({ error: "Something went wrong. Please try again." }, 500);
    }
    return jsonResp({ success: true, message: "Welcome back! You've been re-subscribed." });
  }

  // Insert new subscriber
  const { error } = await adminClient
    .from("newsletter_subscribers")
    .insert({
      email,
      name,
      report_config_id: reportConfigId,
      confirmed: true, // single opt-in
    });

  if (error) {
    if (error.code === "23505") {
      // Unique constraint violation
      return jsonResp({ error: "You're already subscribed!", alreadySubscribed: true }, 409);
    }
    console.error("Subscribe error:", error);
    return jsonResp({ error: "Something went wrong. Please try again." }, 500);
  }

  return jsonResp({ success: true, message: "You're subscribed! You'll receive reports in your inbox." });
});
