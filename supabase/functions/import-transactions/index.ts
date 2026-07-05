// supabase/functions/import-transactions/index.ts
// Deploy with: supabase functions deploy import-transactions --no-verify-jwt
// Manual CSV import fallback for the Plaid feed (e.g. Amex statement
// downloads). Takes parsed rows from the client, runs them through the same
// categorization pipeline as plaid-sync (rules → Claude → Uncategorized),
// dedups, and writes into revenue_transactions / expense_transactions.
//
// Body: {
//   rows: [{ date: 'YYYY-MM-DD', description: string, amount: number }],
//   business: 'mayday_media' | 'neptune_performance',
//   accountLabel: string,            // shows in the `account` column
//   positiveIs: 'expense' | 'revenue' // Amex CSVs: positive = charge (expense)
// }
//
// Dedup, two layers:
// 1. Deterministic transaction_id (hash of row content) — re-uploading the
//    same file is a no-op.
// 2. Cross-source: a Plaid/Tiller row with the same business+date+amount+kind
//    already covering this transaction → skipped, reported in the response.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Mirrors sync-tiller / plaid-sync — Mayday's category taxonomy.
const MAYDAY_INCOME_CATEGORIES = [
  "YouTube Income", "TikTok Income", "Twitch Income", "Substack Income",
  "Sponsorship Income", "Merch Income", "Facebook Income", "Services",
];
const MAYDAY_EXPENSE_CATEGORIES = [
  "Employees", "Rent & Utilities", "Equipment", "Equipment - Neptune",
  "R&D/Production", "Travel", "Admin Subscriptions", "Creative Subscriptions",
  "Insurance", "Freelancers", "Misc Expense", "Administration", "Supplies",
  "Entertainment/Fun", "Medical", "Food", "Bank Fees", "Taxes",
];

const MAX_ROWS = 2000;
const VALID_BUSINESSES = new Set(["mayday_media", "neptune_performance"]);

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Accepts YYYY-MM-DD or M/D/YYYY, returns YYYY-MM-DD or null.
function normalizeDate(s: string): string | null {
  const t = (s || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
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
    const body = await req.json();
    const business = body.business;
    const accountLabel = (body.accountLabel || "CSV import").slice(0, 80);
    const positiveIs = body.positiveIs === "revenue" ? "revenue" : "expense";
    if (!VALID_BUSINESSES.has(business)) {
      return new Response(JSON.stringify({ error: "Invalid business" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!Array.isArray(body.rows) || body.rows.length === 0) {
      return new Response(JSON.stringify({ error: "No rows" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (body.rows.length > MAX_ROWS) {
      return new Response(JSON.stringify({ error: `Max ${MAX_ROWS} rows per import` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Normalize + deterministic ids ──
    const summary = { imported: 0, skipped_duplicates: 0, skipped_invalid: 0, ai_categorized: 0 };
    type Row = {
      transaction_id: string; date: string; description: string;
      amount_cents: number; kind: "revenue" | "expense";
      category: string | null; categorized_by: string | null;
    };
    const rows: Row[] = [];
    const seenKeys = new Map<string, number>(); // within-file duplicate counter
    for (const raw of body.rows) {
      const date = normalizeDate(raw.date);
      const description = String(raw.description || "").trim().slice(0, 300);
      const amount = Number(raw.amount);
      if (!date || !description || !Number.isFinite(amount) || amount === 0) {
        summary.skipped_invalid++;
        continue;
      }
      const cents = Math.round(Math.abs(amount) * 100);
      const kind = (amount > 0) === (positiveIs === "expense") ? "expense" : "revenue";
      const key = `${business}|${date}|${description.toUpperCase()}|${cents}|${kind}`;
      // Identical legit rows in one file (two same-price charges same day)
      // get an occurrence suffix so both survive.
      const n = seenKeys.get(key) || 0;
      seenKeys.set(key, n + 1);
      rows.push({
        transaction_id: `csv_${await sha256Hex(n === 0 ? key : `${key}#${n}`)}`,
        date, description, amount_cents: cents, kind,
        category: null, categorized_by: null,
      });
    }

    if (rows.length === 0) {
      return new Response(JSON.stringify({ ok: true, ...summary }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Dedup ──
    const minDate = rows.reduce((a, r) => (r.date < a ? r.date : a), rows[0].date);
    const maxDate = rows.reduce((a, r) => (r.date > a ? r.date : a), rows[0].date);
    const existingIds = new Set<string>();
    const crossKeys = new Set<string>(); // date|cents from other sources
    for (const table of ["revenue_transactions", "expense_transactions"]) {
      const kind = table === "revenue_transactions" ? "revenue" : "expense";
      // Same-id rows (prior uploads of this file)
      const ids = rows.filter((r) => r.kind === kind).map((r) => r.transaction_id);
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await supabase.from(table)
          .select("transaction_id").in("transaction_id", ids.slice(i, i + 200));
        (data || []).forEach((r) => existingIds.add(r.transaction_id));
      }
      // Cross-source rows already covering the same money movement
      const { data: overlap } = await supabase.from(table)
        .select("date, amount_cents")
        .eq("business", business)
        .neq("source", "manual")
        .gte("date", minDate).lte("date", maxDate);
      (overlap || []).forEach((r) => crossKeys.add(`${kind}|${r.date}|${r.amount_cents}`));
    }

    const fresh = rows.filter((r) => {
      if (existingIds.has(r.transaction_id)) { summary.skipped_duplicates++; return false; }
      if (crossKeys.has(`${r.kind}|${r.date}|${r.amount_cents}`)) { summary.skipped_duplicates++; return false; }
      return true;
    });

    // ── Categorize: rules → Claude → Uncategorized ──
    const { data: rules } = await supabase
      .from("category_rules").select("*")
      .order("priority", { ascending: false });
    for (const r of fresh) {
      const desc = r.description.toUpperCase();
      const rule = (rules || []).find((rule) =>
        rule.txn_kind === r.kind &&
        (!rule.business || rule.business === business) &&
        (rule.match_type === "exact"
          ? desc === rule.pattern.toUpperCase()
          : desc.includes(rule.pattern.toUpperCase()))
      );
      if (rule) { r.category = rule.category; r.categorized_by = "rule"; }
    }

    const uncat = fresh.filter((r) => !r.category);
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
            "If genuinely unknowable, use \"Uncategorized\".",
            "",
            "Transactions:",
            JSON.stringify(chunk.map((t) => ({
              description: t.description, amount: t.amount_cents / 100,
              kind: t.kind, business,
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
            t.category = typeof cats[idx] === "string" ? cats[idx] : "Uncategorized";
            t.categorized_by = "ai";
            summary.ai_categorized++;
          });
        } catch (err) {
          console.error("Claude categorization failed for chunk:", err);
        }
      }
    }
    for (const r of fresh) {
      if (!r.category) { r.category = "Uncategorized"; r.categorized_by = "ai"; }
    }

    // ── Insert ──
    for (const table of ["revenue_transactions", "expense_transactions"]) {
      const kind = table === "revenue_transactions" ? "revenue" : "expense";
      const batch = fresh.filter((r) => r.kind === kind).map((r) => ({
        transaction_id: r.transaction_id,
        date: r.date, description: r.description, amount_cents: r.amount_cents,
        account: accountLabel, business,
        source: "manual",
        category: r.category,
        categorized_by: r.categorized_by,
        review_status: r.categorized_by === "rule" ? "confirmed" : "auto",
        is_transfer: false,
        last_seen_at: new Date().toISOString(),
      }));
      for (let i = 0; i < batch.length; i += 200) {
        const { error } = await supabase.from(table).insert(batch.slice(i, i + 200));
        if (error) console.error("Insert failed:", error.message);
        else summary.imported += batch.slice(i, i + 200).length;
      }
    }

    return new Response(JSON.stringify({ ok: true, ...summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("import-transactions error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
