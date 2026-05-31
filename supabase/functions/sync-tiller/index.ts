// supabase/functions/sync-tiller/index.ts
// Deploy with: supabase functions deploy sync-tiller --no-verify-jwt
// Reads revenue transactions from Tiller Google Sheet and upserts into revenue_transactions table
// Cron: daily at 7am UTC

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SPREADSHEET_ID = "1xbF4vHvt1d_VBAW4gpm7fu6D084CMFm-XQ_WDGoEAGA";
const SHEET_NAME = "Transactions";

// Categories to sync — these are income categories from Tiller
const INCOME_CATEGORIES = new Set([
  "YouTube Income",
  "TikTok Income",
  "Twitch Income",
  "Substack Income",
  "Sponsorship Income",
  "Merch Income",
  "Facebook Income",
  "Services",
]);

// Operating expense categories. Excludes financing (Funding, Loan Repayment),
// offsets (Reimbursement), and net-positive bookkeeping (Interest) so the
// Expenses page reflects actual outflows. New Tiller categories that should
// be tracked need to be added here AND in the EXPENSE_CATEGORY_META map in
// src/pages/Expenses.js.
const EXPENSE_CATEGORIES = new Set([
  "Employees",
  "Rent & Utilities",
  "Equipment",
  "Equipment - Neptune",
  "R&D/Production",
  "Travel",
  "Admin Subscriptions",
  "Creative Subscriptions",
  "Insurance",
  "Freelancers",
  "Misc Expense",
  "Administration",
  "Supplies",
  "Entertainment/Fun",
  "Medical",
  "Food",
  "Bank Fees",
  "Taxes",
]);

async function getAccessToken(): Promise<string> {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID")!;
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
  const refreshToken = Deno.env.get("GOOGLE_DRIVE_REFRESH_TOKEN")!;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const tokens = await res.json();
  if (!res.ok) throw new Error(tokens.error_description || "Token refresh failed");
  return tokens.access_token;
}

function parseAmount(raw: string): number {
  // Remove $, commas, quotes, and whitespace, then parse
  const cleaned = raw.replace(/[$,"'\s]/g, "");
  const value = parseFloat(cleaned);
  if (isNaN(value)) return 0;
  return Math.round(value * 100); // store as cents
}

function parseDate(raw: string): string | null {
  // Tiller dates are M/D/YYYY format
  const parts = raw.split("/");
  if (parts.length !== 3) return null;
  const [m, d, y] = parts;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const accessToken = await getAccessToken();

    // Read all data from the Transactions sheet
    // Column layout: (empty), Date, Description, Category, Amount, Account, ...
    const range = encodeURIComponent(`${SHEET_NAME}!A:F`);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}?majorDimension=ROWS`;

    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Sheets API error ${resp.status}: ${errText}`);
    }

    const data = await resp.json();
    const rows: string[][] = data.values || [];

    if (rows.length < 2) {
      return new Response(JSON.stringify({ message: "No data rows found", rows: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Skip header row, parse transactions
    type Tx = {
      transaction_id: string;
      date: string;
      description: string;
      category: string;
      amount_cents: number;
      account: string;
    };
    const incomeTxs: Tx[] = [];
    const expenseTxs: Tx[] = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      // Columns: 0=(empty), 1=Date, 2=Description, 3=Category, 4=Amount, 5=Account
      const category = (row[3] || "").trim();
      const isIncome = INCOME_CATEGORIES.has(category);
      const isExpense = EXPENSE_CATEGORIES.has(category);
      if (!isIncome && !isExpense) continue;

      const dateStr = parseDate((row[1] || "").trim());
      if (!dateStr) continue;

      const amountCents = parseAmount(row[4] || "0");
      // Income: only positive amounts. Expense: only outflows (negative),
      // stored as positive cents so the Expenses page can sum and chart
      // without flipping signs on every render.
      if (isIncome && amountCents <= 0) continue;
      if (isExpense && amountCents >= 0) continue;

      const description = (row[2] || "").trim();
      const account = (row[5] || "").trim();
      // Stable per-row ID. Includes account and a 1-based sheet row number so
      // recurring identical-looking transactions (e.g. weekly payroll where
      // description + amount + date all match across employees) don't collide
      // and silently dedupe down to one row.
      const sheetRow = i + 1;
      const descSlug = description.replace(/\W+/g, "_");
      const accountSlug = account.replace(/\W+/g, "_");
      const txId = `tiller_${dateStr}_${amountCents}_${accountSlug}_${descSlug}_r${sheetRow}`;
      const storeAmount = isExpense ? -amountCents : amountCents;

      const tx: Tx = {
        transaction_id: txId,
        date: dateStr,
        description,
        category,
        amount_cents: storeAmount,
        account,
      };
      if (isIncome) incomeTxs.push(tx);
      else expenseTxs.push(tx);
    }

    async function upsertBatched(table: string, txs: Tx[]): Promise<number> {
      let upserted = 0;
      for (let i = 0; i < txs.length; i += 200) {
        const batch = txs.slice(i, i + 200);
        const { error, data: result } = await supabase
          .from(table)
          .upsert(batch, { onConflict: "transaction_id" })
          .select("id");
        if (error) {
          console.error(`${table} upsert error:`, error.message);
        } else {
          upserted += result?.length || 0;
        }
      }
      return upserted;
    }

    const incomeUpserted = await upsertBatched("revenue_transactions", incomeTxs);
    const expenseUpserted = await upsertBatched("expense_transactions", expenseTxs);

    console.log(
      `Tiller sync complete: ${incomeTxs.length} income (${incomeUpserted} upserted), ${expenseTxs.length} expense (${expenseUpserted} upserted)`,
    );

    return new Response(JSON.stringify({
      total_rows_read: rows.length - 1,
      income_transactions: incomeTxs.length,
      income_upserted: incomeUpserted,
      expense_transactions: expenseTxs.length,
      expense_upserted: expenseUpserted,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Tiller sync error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
