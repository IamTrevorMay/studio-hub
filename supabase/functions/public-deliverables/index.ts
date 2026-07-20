// supabase/functions/public-deliverables/index.ts
//
// PUBLIC, login-free read of upcoming sponsor deliverables for the shareable
// /deliverables page. Deployed with `--no-verify-jwt` — there is NO auth check
// by design; the page is intentionally public.
//
// The ONLY thing keeping sensitive data safe is the hard-coded column
// allowlist below. It returns sponsor/brand names, dates, and status ONLY —
// never pay, notes, or ad_copy. Never widen this select to `*` or add money/
// notes columns.
//
// Deploy: supabase functions deploy public-deliverables --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

// Rolling window: upcoming + recent. Deliverables due on/after (today - 30d),
// no upper cap. There is no archived flag on sponsor_deliverables (hard delete),
// so the date window is the only filter. Rows with a null due_date are excluded
// (the window is due_date-based).
const WINDOW_DAYS = 30;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // Service role bypasses RLS; safety is the explicit column allowlist below.
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const cutoff = new Date(Date.now() - WINDOW_DAYS * 86400000)
      .toISOString()
      .slice(0, 10); // YYYY-MM-DD

    const { data, error } = await admin
      .from("sponsor_deliverables")
      // Trimmed allowlist — NO pay / notes / ad_copy. Do not change to `*`.
      .select(
        "id, title, deliverable_type, status, review_status, due_date, slot_date, delivered, completed_at, " +
          "sponsor:sponsors(name), campaign:sponsor_campaigns(name)",
      )
      .gte("due_date", cutoff)
      .order("due_date", { ascending: true });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Flatten to the exact public shape (never spread the raw row).
    const deliverables = (data || []).map((d: Record<string, any>) => ({
      id: d.id,
      title: d.title,
      deliverable_type: d.deliverable_type,
      status: d.status,
      review_status: d.review_status,
      due_date: d.due_date,
      slot_date: d.slot_date,
      delivered: d.delivered,
      completed_at: d.completed_at,
      sponsor_name: d.sponsor?.name ?? null,
      brand_name: d.campaign?.name ?? null,
    }));

    return new Response(JSON.stringify({ deliverables }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        // Short public cache; page also polls on its own.
        "Cache-Control": "public, max-age=60",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
