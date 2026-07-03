import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

    // Check if the user is an admin
    const { data: profile } = await userClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profile?.role !== "admin") {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse the request body
    const { email, role, title, payment_type, rate, contract_storage_path, contract_file_name, contract_needs_signing, blocked_folders, assigned_drive_folder_id, assigned_drive_folder_name } = await req.json();
    if (!email) {
      return new Response(JSON.stringify({ error: "Email is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const inviteRole = role || "member";
    const normalizedEmail = email.toLowerCase().trim();

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
        title: title || null,
        payment_type: payment_type || null,
        rate: rate != null ? Number(rate) : null,
        assigned_drive_folder_id: assigned_drive_folder_id || null,
        assigned_drive_folder_name: assigned_drive_folder_name || null,
      },
      redirectTo: Deno.env.get("SITE_URL") || "https://studio-hub-fawn.vercel.app",
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
      title: title || null,
      payment_type: payment_type || null,
      rate: rate != null ? Number(rate) : null,
      contract_storage_path: contract_storage_path || null,
      contract_file_name: contract_file_name || null,
      contract_needs_signing: contract_needs_signing != null ? contract_needs_signing : null,
      assigned_drive_folder_id: assigned_drive_folder_id || null,
      assigned_drive_folder_name: assigned_drive_folder_name || null,
    });
    if (inviteLogError) {
      console.error("Failed to log invitation:", inviteLogError);
    }

    // ── Cloud integration: create Cloud user + set folder restrictions ──
    const cloudApiUrl = Deno.env.get("CLOUD_API_URL");
    const cloudApiKey = Deno.env.get("CLOUD_API_KEY");

    if (cloudApiUrl && cloudApiKey) {
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
            display_name: title || null,
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
