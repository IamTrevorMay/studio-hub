import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Who may invite, and whom they may invite. Directors are admin-tier and run
// contractor/client onboarding, so they can send those invites — but only a
// full admin can mint another admin-tier account, otherwise a director could
// promote themselves by inviting a second account.
const ADMIN_TIER_ROLES = ["admin", "director", "director_creative", "director_comms"];
const ELEVATED_INVITE_ROLES = new Set(ADMIN_TIER_ROLES);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Verify the caller is authenticated and is an admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create a client with the user's JWT to verify they're admin
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

    // Check that the caller is admin-tier
    const { data: profile } = await userClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    const callerRole = profile?.role;
    if (!ADMIN_TIER_ROLES.includes(callerRole)) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse the request body
    const { email, role, title, sub_role, payment_type, rate, contract_storage_path, contract_file_name, contract_needs_signing, blocked_folders, assigned_drive_folder_id, assigned_drive_folder_name, retainer_enabled, retainer_min_hours, overtime_enabled, overtime_max_hours, overtime_multiplier } = await req.json();
    if (!email) {
      return new Response(JSON.stringify({ error: "Email is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const inviteRole = role || "member";
    const normalizedEmail = email.toLowerCase().trim();

    // Privilege escalation guard: a director inviting an admin or another
    // director would hand out their own tier (or above) without a full admin
    // ever approving it. The UI hides this path; this is the boundary.
    if (callerRole !== "admin" && ELEVATED_INVITE_ROLES.has(inviteRole)) {
      return new Response(JSON.stringify({ error: "Only a full admin can invite admins or directors" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Clients are external customers: no sub-role, no payment plumbing, no
    // Cloud account, no drive-folder assignment.
    const isClientInvite = inviteRole === "client";
    const effectivePaymentType = isClientInvite ? null : (payment_type || null);
    const effectiveRate = isClientInvite || rate == null ? null : Number(rate);

    // Sub-role plumbing: the Contractors page carries the contractor sub-role as
    // `title`; the Admin Panel sends `sub_role`. Keep both columns mirrored so
    // the deprecated `title` display keeps working for contractors.
    const effectiveSubRole = isClientInvite ? null : (sub_role || (inviteRole === "contractor" ? title : null) || null);
    const effectiveTitle = isClientInvite ? (title || null) : (title || (inviteRole === "contractor" ? sub_role : null) || null);

    // Hourly retainer/overtime settings — only meaningful for hourly payment.
    // Sanitize: keep the numeric floor/cap only when its toggle is on.
    const isHourly = !isClientInvite && payment_type === "hourly";
    const retainerOn = isHourly && retainer_enabled === true;
    const overtimeOn = isHourly && overtime_enabled === true;
    const inviteRetainerEnabled = retainerOn;
    const inviteRetainerMin = retainerOn && retainer_min_hours != null ? Number(retainer_min_hours) : null;
    const inviteOvertimeEnabled = overtimeOn;
    const inviteOvertimeMax = overtimeOn && overtime_max_hours != null ? Number(overtime_max_hours) : null;
    const inviteOvertimeMult = isHourly && overtime_multiplier != null ? Number(overtime_multiplier) : (isHourly ? 1.5 : null);

    // Create an admin client with the service role key to invite users
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Send the invite email. Pass role in user_metadata so the
    // handle_new_user() trigger picks it up when the profile is auto-created.
    const { data, error } = await adminClient.auth.admin.inviteUserByEmail(normalizedEmail, {
      data: {
        role: inviteRole,
        title: effectiveTitle,
        sub_role: effectiveSubRole,
        payment_type: effectivePaymentType,
        rate: effectiveRate,
        assigned_drive_folder_id: isClientInvite ? null : (assigned_drive_folder_id || null),
        assigned_drive_folder_name: isClientInvite ? null : (assigned_drive_folder_name || null),
      },
      redirectTo: Deno.env.get("SITE_URL") || "https://www.maydaystudio.app",
    });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Log the invite in the invitations table (AuthPage looks this up on accept)
    const { error: inviteLogError } = await adminClient.from("invitations").insert({
      email: normalizedEmail,
      invited_by: user.id,
      accepted_at: null,
      role: inviteRole,
      title: effectiveTitle,
      sub_role: effectiveSubRole,
      payment_type: effectivePaymentType,
      rate: effectiveRate,
      contract_storage_path: contract_storage_path || null,
      contract_file_name: contract_file_name || null,
      contract_needs_signing: contract_needs_signing != null ? contract_needs_signing : null,
      assigned_drive_folder_id: isClientInvite ? null : (assigned_drive_folder_id || null),
      assigned_drive_folder_name: isClientInvite ? null : (assigned_drive_folder_name || null),
      retainer_enabled: inviteRetainerEnabled,
      retainer_min_hours: inviteRetainerMin,
      overtime_enabled: inviteOvertimeEnabled,
      overtime_max_hours: inviteOvertimeMax,
      overtime_multiplier: inviteOvertimeMult,
    });
    if (inviteLogError) {
      console.error("Failed to log invitation:", inviteLogError);
    }

    // ── Cloud integration: create Cloud user + set folder restrictions ──
    // Skipped for clients — they never touch the asset cloud.
    const cloudApiUrl = Deno.env.get("CLOUD_API_URL");
    const cloudApiKey = Deno.env.get("CLOUD_API_KEY");

    if (!isClientInvite && cloudApiUrl && cloudApiKey) {
      try {
        // Create Cloud user account
        const createResp = await fetch(`${cloudApiUrl}/api/restrictions/admin/users`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${cloudApiKey}`,
          },
          body: JSON.stringify({
            email: email.toLowerCase().trim(),
            display_name: effectiveTitle,
            role: "member",
          }),
        });

        if (createResp.ok) {
          const cloudUser = await createResp.json();
          const cloudUserId = cloudUser.id;

          // Set folder restrictions if any folders are blocked
          if (Array.isArray(blocked_folders) && blocked_folders.length > 0) {
            await fetch(`${cloudApiUrl}/api/restrictions/admin/users/${cloudUserId}/folders`, {
              method: "PUT",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${cloudApiKey}`,
              },
              body: JSON.stringify({ blocked_folders }),
            });
          }

          // Update invitations row with Cloud info
          await adminClient.from("invitations")
            .update({ cloud_user_id: cloudUserId, blocked_folders: blocked_folders || [] })
            .eq("email", email.toLowerCase().trim())
            .is("accepted_at", null);
        } else {
          const errText = await createResp.text();
          console.error("Cloud user creation failed:", createResp.status, errText);
        }
      } catch (cloudErr) {
        console.error("Cloud integration error (non-fatal):", cloudErr.message);
      }
    }

    return new Response(
      JSON.stringify({ success: true, message: `Invitation email sent to ${email}` }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
