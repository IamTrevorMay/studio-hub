// supabase/functions/admin-update-user/index.ts
// Changes a user's login email from the Admin Panel's user detail drawer.
//
// The profiles row is writable directly through RLS, but auth.users is not —
// editing the email there is what actually moves their sign-in, so it has to
// run with the service role behind an admin check.
//
// Body: { userId, email }
// Deploy: supabase functions deploy admin-update-user --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Admin-tier may edit ordinary accounts; only a full admin may touch another
// admin-tier account — same rule as invite-user / remove-user, so a director
// can't reroute an admin's login to an address they control.
const ADMIN_TIER = ["admin", "director", "director_creative", "director_comms"];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No authorization header" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: "Not authenticated" }, 401);

    const { data: callerProfile } = await userClient
      .from("profiles").select("role").eq("id", user.id).single();
    const callerRole = callerProfile?.role;
    if (!ADMIN_TIER.includes(callerRole)) return json({ error: "Admin access required" }, 403);

    const { userId, email } = await req.json();
    if (!userId || !email) return json({ error: "userId and email are required" }, 400);

    const normalized = String(email).toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      return json({ error: "That doesn't look like a valid email address" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: target } = await admin
      .from("profiles").select("role, email").eq("id", userId).single();
    if (!target) return json({ error: "User not found" }, 404);

    if (ADMIN_TIER.includes(target.role) && callerRole !== "admin") {
      return json({ error: "Only a full admin can edit an admin-tier account" }, 403);
    }

    if (target.email?.toLowerCase() === normalized) {
      return json({ ok: true, email: normalized, unchanged: true });
    }

    // Reject a collision up front — the auth update would fail anyway, but with
    // a message that doesn't say which address is taken.
    const { data: clash } = await admin
      .from("profiles").select("id").ilike("email", normalized).neq("id", userId).maybeSingle();
    if (clash) return json({ error: "Another account already uses that email" }, 400);

    // auth.users first: if it fails, the profile row still matches their login.
    const { error: authErr } = await admin.auth.admin.updateUserById(userId, {
      email: normalized,
      email_confirm: true,
    });
    if (authErr) return json({ error: `Auth update failed: ${authErr.message}` }, 400);

    const { error: profErr } = await admin
      .from("profiles").update({ email: normalized, updated_at: new Date().toISOString() })
      .eq("id", userId);
    if (profErr) return json({ error: `Profile update failed: ${profErr.message}` }, 500);

    return json({ ok: true, email: normalized });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Unexpected error" }, 500);
  }
});
