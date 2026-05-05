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
    const transactions: Array<{
      transaction_id: string;
      date: string;
      description: string;
      category: string;
      amount_cents: number;
      account: string;
    }> = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      // Columns: 0=(empty), 1=Date, 2=Description, 3=Category, 4=Amount, 5=Account
      const category = (row[3] || "").trim();
      if (!INCOME_CATEGORIES.has(category)) continue;

      const dateStr = parseDate((row[1] || "").trim());
      if (!dateStr) continue;

      const amountCents = parseAmount(row[4] || "0");
      if (amountCents <= 0) continue; // skip negative/zero amounts

      const description = (row[2] || "").trim();
      const account = (row[5] || "").trim();

      // Create a stable transaction ID from date + description + amount
      // This prevents duplicates on re-sync
      const txId = `tiller_${dateStr}_${amountCents}_${description.substring(0, 50).replace(/\W/g, "_")}`;

      transactions.push({
        transaction_id: txId,
        date: dateStr,
        description,
        category,
        amount_cents: amountCents,
        account,
      });
    }

    // Upsert in batches
    let upserted = 0;
    for (let i = 0; i < transactions.length; i += 200) {
      const batch = transactions.slice(i, i + 200);
      const { error, data: result } = await supabase
        .from("revenue_transactions")
        .upsert(batch, { onConflict: "transaction_id" })
        .select("id");
      if (error) {
        console.error("Upsert error:", error.message);
      } else {
        upserted += result?.length || 0;
      }
    }

    console.log(`Tiller sync complete: ${transactions.length} income transactions found, ${upserted} upserted`);

    return new Response(JSON.stringify({
      total_rows_read: rows.length - 1,
      income_transactions: transactions.length,
      upserted,
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
