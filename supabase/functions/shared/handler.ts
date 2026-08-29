import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkRateLimit } from "./utils.ts";

export type AuthMode = "cron" | "jwt" | "admin_jwt" | "cron_or_admin_jwt" | "public";

export interface HandlerContext {
  req: Request;
  admin: ReturnType<typeof createClient>;
  user?: { id: string; email?: string };
  profile?: { role: string };
  isCron: boolean;
}

interface HandlerOptions {
  auth: AuthMode;
  methods?: string[];
  rateLimitBucket?: string;
  rateLimitMax?: number;
  rateLimitWindowMs?: number;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS, PUT, DELETE",
};

function jsonRes(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Copy a Response, adding the CORS headers. Existing headers win so a handler
// can still opt into a narrower Access-Control-Allow-Origin (assistant-summary
// restricts its origins deliberately).
function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [key, value] of Object.entries(corsHeaders)) {
    if (!headers.has(key)) headers.set(key, value);
  }
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

export function createHandler(
  options: HandlerOptions,
  handler: (ctx: HandlerContext) => Promise<Response>
): (req: Request) => Promise<Response> {
  const {
    auth,
    methods = ["POST", "GET"],
    rateLimitBucket,
    rateLimitMax = 30,
    rateLimitWindowMs = 3600000,
  } = options;

  return async (req: Request): Promise<Response> => {
    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Method enforcement
    if (!methods.includes(req.method)) {
      return jsonRes({ error: `Method ${req.method} not allowed` }, 405);
    }

    try {
      const admin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );

      let isCron = false;
      let user: { id: string; email?: string } | undefined;
      let profile: { role: string } | undefined;

      // ── Auth check ──
      if (auth === "public") {
        // No auth required
      } else if (auth === "cron") {
        const cronSecret = Deno.env.get("CRON_SECRET");
        const provided =
          req.headers.get("x-cron-secret") ??
          new URL(req.url).searchParams.get("secret");
        if (!cronSecret || provided !== cronSecret) {
          return jsonRes({ error: "Unauthorized" }, 401);
        }
        isCron = true;
      } else if (auth === "jwt" || auth === "admin_jwt") {
        const authHeader = req.headers.get("Authorization");
        if (!authHeader?.startsWith("Bearer ")) {
          return jsonRes({ error: "Unauthorized" }, 401);
        }
        const { data: { user: u } } = await admin.auth.getUser(authHeader.slice(7));
        if (!u) return jsonRes({ error: "Unauthorized" }, 401);
        user = { id: u.id, email: u.email };

        if (auth === "admin_jwt") {
          const { data: p } = await admin
            .from("profiles")
            .select("role")
            .eq("id", u.id)
            .single();
          if (p?.role !== "admin") {
            return jsonRes({ error: "Forbidden" }, 403);
          }
          profile = p;
        }
      } else if (auth === "cron_or_admin_jwt") {
        const cronSecret = Deno.env.get("CRON_SECRET");
        const provided =
          req.headers.get("x-cron-secret") ??
          new URL(req.url).searchParams.get("secret");
        if (cronSecret && provided === cronSecret) {
          isCron = true;
        } else {
          const authHeader = req.headers.get("Authorization");
          if (!authHeader?.startsWith("Bearer ")) {
            return jsonRes({ error: "Unauthorized" }, 401);
          }
          const { data: { user: u } } = await admin.auth.getUser(authHeader.slice(7));
          if (!u) return jsonRes({ error: "Unauthorized" }, 401);
          user = { id: u.id, email: u.email };
          const { data: p } = await admin
            .from("profiles")
            .select("role")
            .eq("id", u.id)
            .single();
          if (p?.role !== "admin") {
            return jsonRes({ error: "Forbidden" }, 403);
          }
          profile = p;
        }
      }

      // ── Rate limiting ──
      if (rateLimitBucket && user) {
        const { allowed } = await checkRateLimit(
          admin,
          rateLimitBucket,
          user.id,
          rateLimitMax,
          rateLimitWindowMs
        );
        if (!allowed) {
          return jsonRes({ error: "Rate limit exceeded. Try again later." }, 429);
        }
      }

      // ── Execute handler ──
      // Handlers that build their own Response would otherwise ship without
      // CORS headers (jsonRes only covers the preflight + error paths), which
      // makes the browser discard an otherwise-successful 200. Stamp them on
      // the way out so a handler can't forget.
      const res = await handler({ req, admin, user, profile, isCron });
      return withCors(res);
    } catch (err) {
      console.error("Unhandled error in edge function:", err);
      return jsonRes({ error: err.message || "Internal server error" }, 500);
    }
  };
}
