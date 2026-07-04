// supabase/functions/plaid-link-token/index.ts
// Deploy with: supabase functions deploy plaid-link-token --no-verify-jwt
// Creates a Plaid Link token for the frontend Link flow. Pass { itemId } to
// get an update-mode token for relinking an existing broken connection.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PLAID_BASE: Record<string, string> = {
  sandbox: "https://sandbox.plaid.com",
  production: "https://production.plaid.com",
};

function plaidUrl(path: string): string {
  const env = Deno.env.get("PLAID_ENV") || "sandbox";
  return `${PLAID_BASE[env] || PLAID_BASE.sandbox}${path}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Auth: admin JWT required (user-facing flow, never cron)
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: { user } } = await supabase.auth.getUser(auth.slice(7));
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const { data: profile } = await supabase
    .from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));

    const payload: Record<string, unknown> = {
      client_id: Deno.env.get("PLAID_CLIENT_ID"),
      secret: Deno.env.get("PLAID_SECRET"),
      client_name: "Mayday Studio",
      user: { client_user_id: user.id },
      country_codes: ["US"],
      language: "en",
    };

    if (body.itemId) {
      // Update mode: relink an existing item. Products omitted per Plaid docs.
      const { data: item } = await supabase
        .from("plaid_items").select("access_token").eq("id", body.itemId).single();
      if (!item) {
        return new Response(JSON.stringify({ error: "Item not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      payload.access_token = item.access_token;
    } else {
      payload.products = ["transactions"];
      payload.transactions = { days_requested: 90 };
    }

    const res = await fetch(plaidUrl("/link/token/create"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) {
      console.error("Plaid link/token/create failed:", json);
      return new Response(JSON.stringify({ error: json.error_message || "Plaid error" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ link_token: json.link_token }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("plaid-link-token error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
