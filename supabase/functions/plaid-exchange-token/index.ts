// supabase/functions/plaid-exchange-token/index.ts
// Deploy with: supabase functions deploy plaid-exchange-token --no-verify-jwt
// Exchanges a Plaid Link public_token for an access_token, stores the item,
// and registers its accounts in linked_accounts with a business tag each.
// Body: {
//   public_token: string,
//   institution: { id, name },
//   businessByAccount: { [plaid_account_id]: 'mayday_media' | 'neptune_performance' }
// }

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

const PLAID_BASE: Record<string, string> = {
  sandbox: "https://sandbox.plaid.com",
  production: "https://production.plaid.com",
};

function plaidUrl(path: string): string {
  const env = Deno.env.get("PLAID_ENV") || "sandbox";
  return `${PLAID_BASE[env] || PLAID_BASE.sandbox}${path}`;
}

async function plaidPost(path: string, body: Record<string, unknown>) {
  const res = await fetch(plaidUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: Deno.env.get("PLAID_CLIENT_ID"),
      secret: Deno.env.get("PLAID_SECRET"),
      ...body,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error_message || `Plaid ${path} failed`);
  return json;
}

const VALID_BUSINESSES = new Set(["mayday_media", "neptune_performance"]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Auth: admin JWT required
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
  if (!ADMIN_TIER.includes(profile?.role)) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    if (!body.public_token) {
      return new Response(JSON.stringify({ error: "public_token required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const businessByAccount: Record<string, string> = body.businessByAccount || {};

    const exchange = await plaidPost("/item/public_token/exchange", {
      public_token: body.public_token,
    });

    const { data: item, error: itemErr } = await supabase
      .from("plaid_items")
      .upsert({
        item_id: exchange.item_id,
        access_token: exchange.access_token,
        institution_id: body.institution?.id || null,
        institution_name: body.institution?.name || null,
        status: "ok",
        error_code: null,
      }, { onConflict: "item_id" })
      .select("id")
      .single();
    if (itemErr) throw itemErr;

    const accountsRes = await plaidPost("/accounts/get", {
      access_token: exchange.access_token,
    });

    const rows = (accountsRes.accounts || []).map((a: Record<string, any>) => ({
      item_id: item.id,
      plaid_account_id: a.account_id,
      name: a.name || a.official_name || null,
      mask: a.mask || null,
      account_type: a.type || null,
      account_subtype: a.subtype || null,
      business: VALID_BUSINESSES.has(businessByAccount[a.account_id])
        ? businessByAccount[a.account_id]
        : "mayday_media",
      is_active: true,
    }));

    if (rows.length > 0) {
      const { error: acctErr } = await supabase
        .from("linked_accounts")
        .upsert(rows, { onConflict: "plaid_account_id" });
      if (acctErr) throw acctErr;
    }

    return new Response(JSON.stringify({
      item_id: item.id,
      accounts: rows.map((r: Record<string, any>) => ({
        plaid_account_id: r.plaid_account_id, name: r.name, mask: r.mask, business: r.business,
      })),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("plaid-exchange-token error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
