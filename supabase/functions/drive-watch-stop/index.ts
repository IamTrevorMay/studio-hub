// supabase/functions/drive-watch-stop/index.ts
// Soft-deletes a drive_watches row so the poller skips it on the next tick.
// drive_events rows are kept so downstream features still have history.
//
// Auth: admin Supabase JWT.
// POST { watchId: uuid } -> { stopped: true }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Admin tier = admin + director (mirrors the DB is_admin() helper and the
// client-side isAdminTier). Directors are restricted in the UI, not here.
const ADMIN_TIER = ["admin", "director"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single();
    if (!ADMIN_TIER.includes(profile?.role)) {
      return new Response(JSON.stringify({ error: "Admin only" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { watchId } = await req.json();
    if (!watchId) {
      return new Response(JSON.stringify({ error: "watchId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: watch, error: lookupErr } = await admin
      .from("drive_watches")
      .select("id, stopped_at")
      .eq("id", watchId)
      .maybeSingle();
    if (lookupErr) throw new Error(lookupErr.message);
    if (!watch) {
      return new Response(JSON.stringify({ error: "Watch not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (watch.stopped_at) {
      return new Response(JSON.stringify({ stopped: true, already: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: updateErr } = await admin
      .from("drive_watches")
      .update({ stopped_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", watch.id);
    if (updateErr) throw new Error(updateErr.message);

    return new Response(JSON.stringify({ stopped: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
