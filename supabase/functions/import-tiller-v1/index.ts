// supabase/functions/import-tiller-v1/index.ts
// Deploy with: supabase functions deploy import-tiller-v1 --no-verify-jwt
//
// ONE-OFF: imports the historical Mayday Tiller doc (the "old doc", perfectly
// categorized 2025-01-02 → 2026-06-25) into revenue_transactions /
// expense_transactions. The old doc's categories are trusted verbatim; rows
// arrive pre-confirmed and tagged source='tiller_v1' so the daily sync-tiller
// reconcile (which only prunes source='tiller') never touches them.
//
// Idempotent: transaction ids are prefixed tillerv1_ and upserted with
// ON CONFLICT DO NOTHING, so re-runs are safe.
//
// The ongoing sync-tiller Mayday source has minDate '2026-06-26' — everything
// on or before 6/25 belongs to this import, everything after to the live sync.

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

const SPREADSHEET_ID = "1xbF4vHvt1d_VBAW4gpm7fu6D084CMFm-XQ_WDGoEAGA";
const SHEET_NAME = "Transactions";

// Category taxonomy from the old doc's Categories tab. Type decides the table:
// Income → revenue_transactions, Expense → expense_transactions,
// Transfer → placed by sign with is_transfer=true (excluded from P&L).
const INCOME = new Set([
  "Interest", "Services", "TikTok Income", "YouTube Income", "Twitch Income",
  "Substack Income", "Sponsorship Income", "Facebook Income", "Merch Income",
  "Reimbursement",
]);
const EXPENSE = new Set([
  "Entertainment/Fun", "R&D/Production", "Supplies", "Equipment", "Travel",
  "Admin Subscriptions", "Bank Fees", "Taxes", "Creative Subscriptions",
  "Freelancers", "Employees", "Rent & Utilities", "Misc Expense", "Insurance",
  "Food", "Administration", "Medical",
]);
const TRANSFER = new Set(["Loan Repayment", "Funding"]);

// The legacy doc predates the 2026-07-29 Freelancer→Contractor rename, so its
// literal values stay in the match sets above and are renamed on write instead.
// Dropping "Freelancers" from EXPENSE would silently discard those rows.
const LEGACY_CATEGORY_RENAMES: Record<string, string> = {
  "Freelancers": "Contractors",
};

async function getAccessToken(): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      refresh_token: Deno.env.get("GOOGLE_DRIVE_REFRESH_TOKEN")!,
      grant_type: "refresh_token",
    }),
  });
  const tokens = await res.json();
  if (!res.ok) throw new Error(tokens.error_description || "Token refresh failed");
  return tokens.access_token;
}

function parseAmount(raw: string): number {
  const cleaned = (raw || "").replace(/[$,"'\s]/g, "");
  const value = parseFloat(cleaned);
  if (isNaN(value)) return 0;
  return Math.round(value * 100);
}

function parseDate(raw: string): string | null {
  const s = (raw || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const parts = s.split("/");
  if (parts.length !== 3) return null;
  const [m, d, y] = parts;
  if (!m || !d || !y) return null;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Auth: CRON_SECRET (header or query) or admin JWT — same gate as sync-tiller.
  {
    const expected = Deno.env.get("CRON_SECRET");
    const provided = req.headers.get("x-cron-secret")
      ?? new URL(req.url).searchParams.get("secret");
    const isCron = !!expected && provided === expected;
    if (!isCron) {
      const auth = req.headers.get("Authorization");
      if (!auth?.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const adminClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const { data: { user } } = await adminClient.auth.getUser(auth.slice(7));
      if (!user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: profile } = await adminClient
        .from("profiles").select("role").eq("id", user.id).single();
      if (!ADMIN_TIER.includes(profile?.role)) {
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

    const token = await getAccessToken();
    const range = encodeURIComponent(`${SHEET_NAME}!A:Z`);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}?majorDimension=ROWS`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!resp.ok) throw new Error(`Sheets API error ${resp.status}: ${await resp.text()}`);
    const rows: string[][] = (await resp.json()).values || [];

    // Header detection (same approach as sync-tiller).
    let cols: Record<string, number> | null = null;
    let headerRow = 0;
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const cells = (rows[i] || []).map((c) => (c || "").trim().toLowerCase());
      if (cells.includes("date") && cells.includes("amount")) {
        cols = {
          date: cells.indexOf("date"),
          description: cells.indexOf("description"),
          category: cells.indexOf("category"),
          amount: cells.indexOf("amount"),
          account: cells.indexOf("account"),
          txnId: cells.indexOf("transaction id"),
        };
        headerRow = i;
        break;
      }
    }
    if (!cols) throw new Error("Could not detect header row");

    const nowIso = new Date().toISOString();
    const revRows: Record<string, unknown>[] = [];
    const expRows: Record<string, unknown>[] = [];
    const idCounts = new Map<string, number>();
    const nkCounts = new Map<string, number>();
    const unknownCats = new Map<string, number>();
    let skippedZero = 0;

    for (let i = headerRow + 1; i < rows.length; i++) {
      const row = rows[i];
      const dateStr = parseDate(row[cols.date] || "");
      if (!dateStr) continue;
      const cents = parseAmount(row[cols.amount] || "0");
      if (cents === 0) { skippedZero++; continue; }

      const category = (row[cols.category] || "").trim();
      const description = (row[cols.description] || "").trim();
      const account = (row[cols.account] || "").trim();

      let table: "rev" | "exp";
      let amountCents: number;
      let isTransfer = false;
      if (INCOME.has(category)) {
        table = "rev"; amountCents = cents;
      } else if (EXPENSE.has(category)) {
        table = "exp"; amountCents = -cents;
      } else if (TRANSFER.has(category)) {
        isTransfer = true;
        table = cents > 0 ? "rev" : "exp";
        amountCents = Math.abs(cents);
      } else {
        unknownCats.set(category, (unknownCats.get(category) || 0) + 1);
        continue;
      }

      const sheetId = (row[cols.txnId] || "").trim();
      let transactionId: string;
      if (sheetId) {
        const n = (idCounts.get(sheetId) || 0) + 1;
        idCounts.set(sheetId, n);
        transactionId = n === 1 ? `tillerv1_${sheetId}` : `tillerv1_${sheetId}_${n}`;
      } else {
        const nk = `${dateStr}_${cents}_${account.replace(/\W+/g, "_")}_${description.replace(/\W+/g, "_")}`;
        const n = (nkCounts.get(nk) || 0) + 1;
        nkCounts.set(nk, n);
        transactionId = `tillerv1_nk_${nk}_${n}`;
      }

      const record = {
        transaction_id: transactionId,
        date: dateStr,
        description,
        category: LEGACY_CATEGORY_RENAMES[category] ?? category,
        amount_cents: amountCents,
        account,
        business: "mayday_media",
        source: "tiller_v1",
        review_status: "confirmed",
        categorized_by: "tiller",
        is_transfer: isTransfer,
        last_seen_at: nowIso,
      };
      (table === "rev" ? revRows : expRows).push(record);
    }

    async function insertBatched(tableName: string, records: Record<string, unknown>[]) {
      let inserted = 0, errors = 0;
      for (let i = 0; i < records.length; i += 200) {
        const { error, data } = await supabase
          .from(tableName)
          .upsert(records.slice(i, i + 200), { onConflict: "transaction_id", ignoreDuplicates: true })
          .select("id");
        if (error) { errors++; console.error(`${tableName}:`, error.message); }
        else inserted += data?.length || 0;
      }
      return { inserted, errors };
    }

    const revRes = await insertBatched("revenue_transactions", revRows);
    const expRes = await insertBatched("expense_transactions", expRows);

    return new Response(JSON.stringify({
      parsed: { revenue: revRows.length, expense: expRows.length },
      inserted: { revenue: revRes.inserted, expense: expRes.inserted },
      errors: revRes.errors + expRes.errors,
      skipped_zero_amount: skippedZero,
      unknown_categories: Object.fromEntries(unknownCats),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("import-tiller-v1 error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
