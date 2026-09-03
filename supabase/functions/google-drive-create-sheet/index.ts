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

async function getDriveAccessToken(): Promise<string> {
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // Verify caller is authenticated
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    if (!ADMIN_TIER.includes(profile?.role)) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { folderId, title, beats } = await req.json();
    if (!folderId) throw new Error("folderId is required");
    if (!title) throw new Error("title is required");

    const accessToken = await getDriveAccessToken();

    // Build sheet data: header + one row per beat
    const headerRow = ["Beat + Context", "Graphics", "Videos", "Notes"];
    const formatMediaList = (items: any[]) =>
      (items || []).map((item: any) => typeof item === 'string' ? item : (item.name || '')).join("\n");
    const dataRows = (beats || []).map((b: any) => [
      [b.title || "", b.context || ""].filter(Boolean).join("\n"),
      formatMediaList(b.graphics),
      formatMediaList(b.videos),
      b.notes || "",
    ]);

    const rows = [headerRow, ...dataRows];

    // Create spreadsheet via Sheets API
    const createRes = await fetch("https://sheets.googleapis.com/v4/spreadsheets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        properties: { title },
        sheets: [{
          properties: { title: "Beat Sheet", sheetId: 0 },
          data: [{
            startRow: 0,
            startColumn: 0,
            rowData: rows.map(row => ({
              values: row.map((cell: string) => ({
                userEnteredValue: { stringValue: cell },
              })),
            })),
          }],
        }],
      }),
    });

    const sheetData = await createRes.json();
    if (!createRes.ok) throw new Error(sheetData.error?.message || "Sheets API error");

    const spreadsheetId = sheetData.spreadsheetId;

    // Format: column widths, text wrapping, bold header
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requests: [
          { updateDimensionProperties: {
            range: { sheetId: 0, dimension: "COLUMNS", startIndex: 0, endIndex: 1 },
            properties: { pixelSize: 400 },
            fields: "pixelSize",
          }},
          { updateDimensionProperties: {
            range: { sheetId: 0, dimension: "COLUMNS", startIndex: 1, endIndex: 2 },
            properties: { pixelSize: 250 },
            fields: "pixelSize",
          }},
          { updateDimensionProperties: {
            range: { sheetId: 0, dimension: "COLUMNS", startIndex: 2, endIndex: 3 },
            properties: { pixelSize: 250 },
            fields: "pixelSize",
          }},
          { updateDimensionProperties: {
            range: { sheetId: 0, dimension: "COLUMNS", startIndex: 3, endIndex: 4 },
            properties: { pixelSize: 300 },
            fields: "pixelSize",
          }},
          { repeatCell: {
            range: { sheetId: 0 },
            cell: { userEnteredFormat: { wrapStrategy: "WRAP" } },
            fields: "userEnteredFormat.wrapStrategy",
          }},
          { repeatCell: {
            range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 },
            cell: {
              userEnteredFormat: {
                textFormat: { bold: true, foregroundColorStyle: { rgbColor: { red: 0, green: 0, blue: 0 } } },
                backgroundColor: { red: 1, green: 1, blue: 1 },
              },
            },
            fields: "userEnteredFormat.textFormat.bold,userEnteredFormat.textFormat.foregroundColorStyle,userEnteredFormat.backgroundColor",
          }},
        ],
      }),
    });

    // Move spreadsheet into target Drive folder
    const fileRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${spreadsheetId}?fields=parents&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const fileData = await fileRes.json();
    const previousParents = (fileData.parents || []).join(",");

    await fetch(
      `https://www.googleapis.com/drive/v3/files/${spreadsheetId}?addParents=${folderId}&removeParents=${previousParents}&supportsAllDrives=true`,
      {
        method: "PATCH",
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
    return new Response(JSON.stringify({ sheetUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
