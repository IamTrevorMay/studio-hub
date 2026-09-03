import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SignJWT } from "https://deno.land/x/jose@v5.2.2/index.ts";

// Admin tier = admin + director (mirrors the DB is_admin() helper and the
// client-side isAdminTier). Directors are restricted in the UI, not here.
const ADMIN_TIER = ["admin", "director"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ALLOWED_TARGETS = ["/broadcast", "/visualize"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Verify the caller is authenticated
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: profile } = await userClient.from("profiles").select("role").eq("id", user.id).single();
    if (!ADMIN_TIER.includes(profile?.role)) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse request body
    const { target } = await req.json();
    if (!target || !ALLOWED_TARGETS.includes(target)) {
      return new Response(JSON.stringify({ error: "Invalid target" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Sign a short-lived JWT for Triton
    const secret = Deno.env.get("STUDIO_TRITON_SECRET");
    const tritonUrl = Deno.env.get("TRITON_URL") || "https://www.tritonapex.io";

    if (!secret) {
      return new Response(JSON.stringify({ error: "SSO not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const jwt = await new SignJWT({ email: user.email, target })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("mayday-studio")
      .setExpirationTime("60s")
      .setIssuedAt()
      .sign(new TextEncoder().encode(secret));

    const url = `${tritonUrl}/api/auth/studio-link?token=${jwt}`;

    return new Response(JSON.stringify({ url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
