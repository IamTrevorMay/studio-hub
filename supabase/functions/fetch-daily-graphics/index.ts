import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Auth: cron secret or authenticated user
    const url = new URL(req.url);
    const cronSecret =
      url.searchParams.get("secret") || req.headers.get("x-cron-secret");
    const expectedSecret = Deno.env.get("CRON_SECRET");
    const authHeader = req.headers.get("Authorization");

    if (expectedSecret && cronSecret === expectedSecret) {
      // Cron invocation
    } else if (authHeader) {
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } }
      );
      const {
        data: { user },
        error: userError,
      } = await userClient.auth.getUser();
      if (userError || !user) {
        return new Response(
          JSON.stringify({ error: "Not authenticated" }),
          {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    } else {
      return new Response(
        JSON.stringify({ error: "Not authorized" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Fetch latest graphics index from Triton
    const res = await fetch(
      "https://tritonapex.io/api/daily-graphics?latest=true"
    );
    if (!res.ok) {
      const text = await res.text();
      return new Response(
        JSON.stringify({
          error: "Triton API error",
          status: res.status,
          detail: text,
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const json = await res.json();
    const date = json.date;
    const graphics = json.graphics || [];

    if (!date || graphics.length === 0) {
      return new Response(
        JSON.stringify({ skipped: true, reason: "no_graphics", date }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Upsert into daily_graphics table
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const rows = graphics.map(
      (g: { type: string; date: string; url: string }) => ({
        date: g.date || date,
        type: g.type,
        url: g.url,
      })
    );

    const { error: upsertError } = await admin
      .from("daily_graphics")
      .upsert(rows, { onConflict: "date,type" });

    if (upsertError) {
      return new Response(
        JSON.stringify({ error: "DB upsert failed", detail: upsertError }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({ success: true, date, count: rows.length }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
