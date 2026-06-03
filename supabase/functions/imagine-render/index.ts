// supabase/functions/imagine-render/index.ts
// Deploy: supabase functions deploy imagine-render --no-verify-jwt
//
// Phase 2E STUB. Returns a 1x1 transparent PNG so the Mayday Graphics UI
// can wire its debounce-render loop and prove the auth path works. The
// real skia_canvas renderer replaces the body of this handler in Phase 2F.
//
// Auth: any authenticated Mayday user (Graphics is open per Q16).
//
// POST /imagine-render
//   body: { widget_id: string, filters: object, size: { width, height, label } }
//   resp: image/png bytes (no JSON wrapper — matches Triton's contract so
//         the UI can `await res.blob()` directly)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "x-imagine-stub, x-imagine-widget",
};

function jsonErr(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// 1x1 transparent PNG, 67 bytes. Real renderer in 2F.
const STUB_PNG_BYTES = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") return jsonErr("Method not allowed", 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return jsonErr("Unauthorized", 401);

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return jsonErr("Unauthorized", 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonErr("Invalid JSON body");
  }

  const widget_id = typeof body.widget_id === "string" ? body.widget_id : null;
  if (!widget_id) return jsonErr("widget_id required");

  return new Response(STUB_PNG_BYTES, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "image/png",
      "Cache-Control": "no-store",
      "x-imagine-stub": "1",
      "x-imagine-widget": widget_id,
    },
  });
});
