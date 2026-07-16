// Read-only Tracking snapshot for the Mayday Assistant ("Gerald") at
// assist.mmcreate.io — this month's posting goals, published counts per
// account, recent posts, and active initiative daily targets. Mirrors what
// the Tracking page reads (tracking_post_goals / content_items / admin_goals);
// Metricool-side posts are not included (external API, frontend-only).
//
//   POST /functions/v1/assistant-tracking  {}
//
// NOTE: auth helpers are inlined (copies of shared/workflow-engine.ts's
// getAdminClient/getUserFromJwt) so the function deploys standalone —
// the shared module drags in the whole workflow engine.
//
// Deploy: supabase functions deploy assistant-tracking --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// CORS restricted to the assistant origins — this aggregates admin-level data.
const ALLOWED_ORIGINS = new Set([
  "https://assist.mmcreate.io",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3100",
]);

function cors(req: Request) {
  const origin = req.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://assist.mmcreate.io",
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function resp(req: Request, data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors(req), "Content-Type": "application/json" },
  });
}

function getAdminClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

async function getUserFromJwt(
  req: Request,
): Promise<{ userId: string; isAdmin: boolean } | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) return null;
  const admin = getAdminClient();
  const { data: profile } = await admin
    .from("profiles").select("role").eq("id", user.id).single();
  return { userId: user.id, isAdmin: profile?.role === "admin" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  if (req.method !== "POST") return resp(req, { error: "Method not allowed" }, 405);

  const auth = await getUserFromJwt(req);
  if (!auth) return resp(req, { error: "Unauthorized" }, 401);
  if (!auth.isAdmin) return resp(req, { error: "Admin only" }, 403);

  const admin = getAdminClient();
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const monthStart = new Date(Date.UTC(year, now.getMonth(), 1)).toISOString();
  const nextMonth = new Date(Date.UTC(year, now.getMonth() + 1, 1)).toISOString();

  try {
    const [goalsQ, postsQ, initiativesQ] = await Promise.all([
      admin.from("tracking_post_goals")
        .select("column_key, goal")
        .eq("year", year)
        .eq("month", month),
      admin.from("content_items")
        .select("title, published_at, content_type, platform_account_id, platform_account:platform_accounts(platform, account_name)")
        .gte("published_at", monthStart)
        .lt("published_at", nextMonth)
        .order("published_at", { ascending: false })
        .limit(500),
      admin.from("admin_goals")
        .select("name, daily_target")
        .eq("is_active", true),
    ]);

    const firstError = goalsQ.error || postsQ.error || initiativesQ.error;
    if (firstError) throw firstError;

    type PostRow = {
      title: string | null; published_at: string; content_type: string | null;
      platform_account_id: string;
      platform_account: { platform: string | null; account_name: string | null } | null;
    };
    const posts = (postsQ.data ?? []) as unknown as PostRow[];

    const byAccount = new Map<string, { platform_account_id: string; platform: string | null;
      account_name: string | null; published_this_month: number }>();
    for (const p of posts) {
      const cur = byAccount.get(p.platform_account_id) ?? {
        platform_account_id: p.platform_account_id,
        platform: p.platform_account?.platform ?? null,
        account_name: p.platform_account?.account_name ?? null,
        published_this_month: 0,
      };
      cur.published_this_month += 1;
      byAccount.set(p.platform_account_id, cur);
    }

    return resp(req, {
      generated_at: now.toISOString(),
      year,
      month,
      post_goals: goalsQ.data ?? [], // {column_key (= platform account id for content sources), goal}
      published_by_account: [...byAccount.values()],
      recent_posts: posts.slice(0, 15).map((p) => ({
        title: p.title,
        published_at: p.published_at,
        content_type: p.content_type,
        platform: p.platform_account?.platform ?? null,
        account: p.platform_account?.account_name ?? null,
      })),
      initiatives: initiativesQ.data ?? [], // active daily-goal targets
    });
  } catch (err) {
    console.error("assistant-tracking error:", err);
    return resp(req, { error: "Internal error" }, 500);
  }
});
