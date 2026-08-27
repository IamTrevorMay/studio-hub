import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Admin "View as…" true-impersonation. Mints a short-lived, scoped access
// token for a target account so the admin's preview reads EXACTLY what that
// account's RLS allows. Audited, read-only by intent (the client renders the
// preview read-only and we never return a refresh token, so the access token
// cannot be renewed or persisted).
//
// Targets: contractors (admin-tier callers, the original portal preview) and
// staff members (STRICT admin callers only — 2026-08-27, so an admin can see
// the app exactly as a member does). Admin-tier targets are never allowed:
// that is the self-promotion path the profiles RLS guards against, and a
// director could otherwise mint an admin token for themselves.

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

    // 2. Validate the target.
    const body = await req.json();
    const targetId = body?.target_id || body?.contractor_id;
    if (!targetId) return json({ error: "target_id is required" }, 400);

    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: target, error: targetErr } = await admin
      .from("profiles")
      .select("id, email, full_name, role, sub_role")
      .eq("id", targetId)
      .single();
    if (targetErr || !target) return json({ error: "User not found" }, 404);

    const isContractorTarget = ["contractor", "freelancer"].includes(target.role);
    const isStaffTarget = target.role === "member";
    if (!isContractorTarget && !isStaffTarget) {
      // Covers admin/director (escalation) and client (no client-side preview).
      return json({ error: `Cannot view as a ${target.role || "user"} account` }, 400);
    }
    // Viewing as staff reads the whole app, not a locked portal — strict admin only.
    if (isStaffTarget && callerProfile?.role !== "admin") {
      return json({ error: "Strict admin access required to view as staff" }, 403);
    }
    if (!target.email) return json({ error: "User has no email" }, 400);

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

    const targetInfo = {
      id: target.id,
      full_name: target.full_name,
      role: target.role,
      sub_role: target.sub_role,
    };

    return json({
      access_token: sess.session.access_token,
      expires_at: sess.session.expires_at,
      // The staff preview boots a whole app tree under this identity, so it
      // needs the user object Supabase would normally have cached. Still no
      // refresh token — the preview dies with the tab or the token's hour.
      session: {
        access_token: sess.session.access_token,
        refresh_token: "",
        expires_at: sess.session.expires_at,
        expires_in: sess.session.expires_in,
        token_type: sess.session.token_type,
        user: sess.session.user,
      },
      target: targetInfo,
      contractor: targetInfo, // legacy key — the contractor portal preview reads this
    });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
