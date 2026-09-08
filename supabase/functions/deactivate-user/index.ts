import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Effectively permanent — reactivation clears it explicitly.
const BAN_DURATION = "87600h"; // 10 years

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No authorization header" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return json({ error: "Not authenticated" }, 401);

    // Deactivation is strict-admin only — directors are admin-tier for most
    // things, but disabling accounts stays with full admins.
    const { data: callerProfile } = await userClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (callerProfile?.role !== "admin") {
      return json({ error: "Admin access required" }, 403);
    }

    const { userId, action } = await req.json();
    if (!userId) return json({ error: "userId is required" }, 400);
    if (action !== "deactivate" && action !== "reactivate") {
      return json({ error: "action must be 'deactivate' or 'reactivate'" }, 400);
    }
    if (userId === user.id) {
      return json({ error: "Cannot deactivate yourself" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceKey);

    const { data: target } = await adminClient
      .from("profiles")
      .select("id, full_name")
      .eq("id", userId)
      .single();
    if (!target) return json({ error: "User not found" }, 404);

    if (action === "deactivate") {
      // 1. Auth-level ban — blocks all future logins and token refreshes.
      const { error: banError } = await adminClient.auth.admin.updateUserById(
        userId,
        { ban_duration: BAN_DURATION }
      );
      if (banError) return json({ error: `Failed to ban user: ${banError.message}` }, 500);

      // 2. Flag the profile so live UI surfaces hide them.
      const { error: profileError } = await adminClient
        .from("profiles")
        .update({ deactivated_at: new Date().toISOString() })
        .eq("id", userId);
      if (profileError) {
        // Roll the ban back so we never strand a half-deactivated account.
        await adminClient.auth.admin.updateUserById(userId, { ban_duration: "none" });
        return json({ error: `Failed to flag profile: ${profileError.message}` }, 500);
      }

      // 3. Revoke their active sessions (GoTrue admin logout). Non-fatal:
      // the ban already blocks refresh, and the client kicks itself on the
      // next profile fetch.
      try {
        await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}/logout`, {
          method: "POST",
          headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
        });
      } catch (e) {
        console.warn("Session revoke failed (ban still blocks refresh):", e);
      }

      return json({ success: true, action: "deactivate" });
    }

    // Reactivate: lift the ban, clear the flag.
    const { error: unbanError } = await adminClient.auth.admin.updateUserById(
      userId,
      { ban_duration: "none" }
    );
    if (unbanError) return json({ error: `Failed to unban user: ${unbanError.message}` }, 500);

    const { error: clearError } = await adminClient
      .from("profiles")
      .update({ deactivated_at: null })
      .eq("id", userId);
    if (clearError) return json({ error: `Failed to clear profile flag: ${clearError.message}` }, 500);

    return json({ success: true, action: "reactivate" });
  } catch (err) {
    console.error("deactivate-user error:", err);
    return json({ error: err instanceof Error ? err.message : "Unexpected error" }, 500);
  }
});
