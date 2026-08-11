import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Admin "View as…" true-impersonation. Mints a short-lived, scoped access
// token for a target contractor so the admin's preview reads EXACTLY what that
// contractor's RLS allows. Strict-admin only, audited, read-only by intent
// (the client renders the portal read-only and we never return a refresh
// token, so the access token cannot be renewed or persisted).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // 1. Authenticate the caller and require STRICT admin (role = 'admin').
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No authorization header" }, 401);

    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: "Not authenticated" }, 401);

    const { data: callerProfile } = await userClient
      .from("profiles").select("role").eq("id", user.id).single();
    // Admin-tier: directors run contractor onboarding too.
    const ADMIN_TIER = ["admin", "director", "director_creative", "director_comms"];
    if (!ADMIN_TIER.includes(callerProfile?.role)) {
      return json({ error: "Strict admin access required" }, 403);
    }

    // 2. Validate the target is a contractor.
    const { contractor_id } = await req.json();
    if (!contractor_id) return json({ error: "contractor_id is required" }, 400);

    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: target, error: targetErr } = await admin
      .from("profiles")
      .select("id, email, full_name, role, sub_role")
      .eq("id", contractor_id)
      .single();
    if (targetErr || !target) return json({ error: "Contractor not found" }, 404);
    if (!["contractor", "freelancer"].includes(target.role)) {
      return json({ error: "Target is not a contractor" }, 400);
    }
    if (!target.email) return json({ error: "Contractor has no email" }, 400);

    // 3. Mint a session for the target via a magic-link token (no email is
    //    sent — generateLink only returns the token), then exchange it for a
    //    session server-side. We return ONLY the access token.
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: target.email,
    });
    const tokenHash = linkData?.properties?.hashed_token;
    if (linkErr || !tokenHash) {
      return json({ error: `Failed to mint token: ${linkErr?.message || "no token"}` }, 500);
    }

    const exchangeClient = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: sess, error: otpErr } = await exchangeClient.auth.verifyOtp({
      type: "magiclink",
      token_hash: tokenHash,
    });
    if (otpErr || !sess?.session?.access_token) {
      return json({ error: `Failed to exchange token: ${otpErr?.message || "no session"}` }, 500);
    }

    // 4. Audit the impersonation (best-effort — never block on the log).
    await admin.from("impersonation_audit").insert({
      admin_id: user.id,
      target_id: target.id,
      target_role: target.role,
      target_sub_role: target.sub_role,
    });

    return json({
      access_token: sess.session.access_token,
      expires_at: sess.session.expires_at,
      contractor: {
        id: target.id,
        full_name: target.full_name,
        sub_role: target.sub_role,
      },
    });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
