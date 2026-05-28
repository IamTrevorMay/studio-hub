// supabase/functions/workflow-list-actions/index.ts
// Returns the list of registered action handler slugs + descriptions for the builder dropdown.
// Deploy: supabase functions deploy workflow-list-actions --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  getUserFromJwt,
  corsHeaders,
  jsonResp,
} from "../shared/workflow-engine.ts";
import { listActionSlugs } from "../shared/action-registry.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return jsonResp({ error: "Method not allowed" }, 405);
  }

  const auth = await getUserFromJwt(req);
  if (!auth) return jsonResp({ error: "Unauthorized" }, 401);
  if (!auth.isAdmin) return jsonResp({ error: "Admin only" }, 403);

  return jsonResp({ actions: listActionSlugs() });
});
