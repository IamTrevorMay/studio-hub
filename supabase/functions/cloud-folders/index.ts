import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
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

    const { data: profile } = await userClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    // Admin-tier: directors run contractor onboarding too.
    const ADMIN_TIER = ["admin", "director", "director_creative", "director_comms"];
    if (!ADMIN_TIER.includes(profile?.role)) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch folder list from Cloud API
    const cloudApiUrl = Deno.env.get("CLOUD_API_URL");
    const cloudApiKey = Deno.env.get("CLOUD_API_KEY");

    if (!cloudApiUrl || !cloudApiKey) {
      return new Response(JSON.stringify({ error: "Cloud integration not configured" }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resp = await fetch(`${cloudApiUrl}/api/nas/list?path=`, {
      headers: { Authorization: `Bearer ${cloudApiKey}` },
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Cloud API error: ${resp.status} ${errText}`);
    }

    const items = await resp.json();

    // Filter to directories only and return name + path
    const folders = (Array.isArray(items) ? items : items.items || [])
      .filter((item: any) => item.type === "directory" || item.isDirectory)
      .map((item: any) => ({ name: item.name, path: item.path || `/${item.name}` }));

    return new Response(JSON.stringify(folders), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
