// supabase/functions/categorize-backlog/index.ts
// Deploy with: supabase functions deploy categorize-backlog --no-verify-jwt
// Categorizes transactions still sitting at category='Uncategorized' with
// review_status='auto' — rules first, then Claude. Used to chew through big
// backlogs (initial sheet imports, large CSV uploads) in bounded passes that
// stay inside the edge function timeout. Invoke repeatedly until `remaining`
// hits zero. Body: { limit?: number } (default 200, max 300).

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

const MAYDAY_INCOME_CATEGORIES = [
  "YouTube Income", "TikTok Income", "Twitch Income", "Substack Income",
  "Sponsorship Income", "Merch Income", "Facebook Income", "Services",
  "Production Services",
];
const MAYDAY_EXPENSE_CATEGORIES = [
  "Employees", "Rent & Utilities", "Equipment", "Equipment - Neptune",
  "R&D/Production", "Travel", "Admin Subscriptions", "Creative Subscriptions",
  "Insurance", "Contractors", "Misc Expense", "Administration", "Supplies",
  "Entertainment/Fun", "Medical", "Food", "Bank Fees", "Taxes",
];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Auth: CRON_SECRET (header or query) or admin JWT required
  {
    const _expected = Deno.env.get("CRON_SECRET");
    const _provided = req.headers.get("x-cron-secret")
      ?? new URL(req.url).searchParams.get("secret");
    const _isCron = !!_expected && _provided === _expected;
    if (!_isCron) {
      const _auth = req.headers.get("Authorization");
      if (!_auth?.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const _adminClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const { data: { user: _u } } = await _adminClient.auth.getUser(_auth.slice(7));
      if (!_u) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: _profile } = await _adminClient
        .from("profiles").select("role").eq("id", _u.id).single();
      if (!ADMIN_TIER.includes(_profile?.role)) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Number.isFinite(body.limit) ? body.limit : 200, 300);

    type Row = {
      id: string; description: string; amount_cents: number; business: string;
      table: string; kind: "revenue" | "expense";
      category?: string; categorized_by?: string; is_transfer?: boolean;
    };
    const backlog: Row[] = [];
    for (const [table, kind] of [["revenue_transactions", "revenue"], ["expense_transactions", "expense"]] as const) {
      const { data } = await supabase.from(table)
        .select("id, description, amount_cents, business")
        .eq("category", "Uncategorized").eq("review_status", "auto")
        .order("date", { ascending: false })
        .limit(Math.max(1, limit - backlog.length));
      (data || []).forEach((r) => backlog.push({ ...r, table, kind }));
      if (backlog.length >= limit) break;
    }

    const summary = { rule_categorized: 0, ai_categorized: 0, remaining: 0 };
    if (backlog.length === 0) {
      return new Response(JSON.stringify({ ok: true, ...summary }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Rules pass
    const { data: rules } = await supabase
      .from("category_rules").select("*")
      .order("priority", { ascending: false });
    for (const r of backlog) {
      const desc = r.description.toUpperCase();
      const rule = (rules || []).find((rule) =>
        rule.txn_kind === r.kind &&
        (!rule.business || rule.business === r.business) &&
        (rule.match_type === "exact"
          ? desc === rule.pattern.toUpperCase()
          : desc.includes(rule.pattern.toUpperCase()))
      );
      if (rule) { r.category = rule.category; r.categorized_by = "rule"; summary.rule_categorized++; }
    }

    // Claude pass
    const uncat = backlog.filter((r) => !r.category);
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (uncat.length > 0 && anthropicKey) {
      const { data: neptuneCats } = await supabase
        .from("expense_transactions").select("category")
        .eq("business", "neptune_performance").limit(1000);
      const neptuneExisting = [...new Set((neptuneCats || []).map((r) => r.category))];

      for (let i = 0; i < uncat.length; i += 50) {
        const chunk = uncat.slice(i, i + 50);
        try {
          const prompt = [
            "Categorize these bank transactions for a creator business. Respond ONLY with a JSON array of category strings, one per transaction, same order.",
            "",
            "For business=mayday_media, revenue MUST be one of: " + JSON.stringify(MAYDAY_INCOME_CATEGORIES),
            "For business=mayday_media, expense MUST be one of: " + JSON.stringify(MAYDAY_EXPENSE_CATEGORIES),
            "For business=neptune_performance (a baseball training facility), prefer these existing categories: " + JSON.stringify(neptuneExisting) + " but a new sensible category name is allowed.",
            "A transaction that moves money between the business's own accounts (credit card payments, internal transfers) should be \"Transfer\". Careful: payroll (Gusto) and payment-processor payouts (Venmo) look like transfers but are real expenses.",
            "If genuinely unknowable, use \"Uncategorized\".",
            "",
            "Transactions:",
            JSON.stringify(chunk.map((t) => ({
              description: t.description, amount: t.amount_cents / 100,
              kind: t.kind, business: t.business,
            }))),
          ].join("\n");
          const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": anthropicKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model: Deno.env.get("CLAUDE_MODEL") || "claude-sonnet-4-6",
              max_tokens: 4000,
              messages: [{ role: "user", content: prompt }],
            }),
          });
          const json = await res.json();
          const text = json.content?.[0]?.text || "[]";
          const cats = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1));
          chunk.forEach((t, idx) => {
            const cat = typeof cats[idx] === "string" ? cats[idx] : "Uncategorized";
            if (cat !== "Uncategorized") {
              if (cat === "Transfer") { t.category = "Transfer"; t.is_transfer = true; }
              else t.category = cat;
              t.categorized_by = "ai";
              summary.ai_categorized++;
            }
          });
        } catch (err) {
          console.error("Claude categorization failed for chunk:", err);
        }
      }
    }

    // Write updates (row-by-row; bounded by `limit`)
    for (const r of backlog) {
      if (!r.category) continue;
      await supabase.from(r.table).update({
        category: r.category,
        categorized_by: r.categorized_by,
        is_transfer: r.is_transfer || false,
        // rule matches are settled; AI picks stay in the review inbox
        review_status: r.categorized_by === "rule" ? "confirmed" : "auto",
      }).eq("id", r.id);
    }

    // How many are still uncategorized after this pass
    let remaining = 0;
    for (const table of ["revenue_transactions", "expense_transactions"]) {
      const { count } = await supabase.from(table)
        .select("id", { count: "exact", head: true })
        .eq("category", "Uncategorized").eq("review_status", "auto");
      remaining += count || 0;
    }
    summary.remaining = remaining;

    return new Response(JSON.stringify({ ok: true, ...summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("categorize-backlog error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
