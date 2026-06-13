// Manage Resend sender domains. Admin-only — calls Resend's /domains
// API on behalf of the user and mirrors the result into our
// mailer_sender_domains table so the UI doesn't have to hit Resend on
// every page load.
//
//   POST /functions/v1/mailer-domain  { op: "add", domain }
//   POST /functions/v1/mailer-domain  { op: "verify", domain_id }
//   POST /functions/v1/mailer-domain  { op: "remove", domain_id }
//
// Returns { ok, records?: [...] } for add/verify; records is the DNS
// payload the user should publish.
//
// Deploy: supabase functions deploy mailer-domain --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeaders,
  jsonResp,
  getUserFromJwt,
  getAdminClient,
} from "../shared/workflow-engine.ts";

const RESEND_BASE = "https://api.resend.com";

function resendKey(): string {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) throw new Error("RESEND_API_KEY not set");
  return key;
}

async function resend(path: string, init: RequestInit = {}): Promise<unknown> {
  const resp = await fetch(`${RESEND_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${resendKey()}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await resp.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  if (!resp.ok) {
    const msg = (data && typeof data === "object" && "message" in data && (data as { message: string }).message)
      || `Resend ${resp.status}`;
    const err = new Error(String(msg));
    (err as { status?: number }).status = resp.status;
    throw err;
  }
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResp({ error: "Method not allowed" }, 405);

  const auth = await getUserFromJwt(req);
  if (!auth) return jsonResp({ error: "Unauthorized" }, 401);
  if (!auth.isAdmin) return jsonResp({ error: "Admin only" }, 403);

  let body: { op?: string; domain?: string; domain_id?: string };
  try { body = await req.json(); } catch { return jsonResp({ error: "Invalid JSON" }, 400); }

  const admin = getAdminClient();

  try {
    if (body.op === "add") {
      const domain = (body.domain || "").trim().toLowerCase();
      if (!domain.includes(".")) return jsonResp({ error: "Invalid domain" }, 400);

      // Resend: POST /domains { name }
      const created = await resend("/domains", {
        method: "POST",
        body: JSON.stringify({ name: domain }),
      }) as { id?: string; records?: unknown[] };

      await admin.from("mailer_sender_domains").upsert({
        domain,
        resend_domain_id: created.id || null,
        verified_at: null,
        created_by: auth.userId,
      }, { onConflict: "domain" });

      return jsonResp({ ok: true, records: created.records || [] });
    }

    if (body.op === "verify") {
      if (!body.domain_id) return jsonResp({ error: "domain_id required" }, 400);
      const { data: row } = await admin
        .from("mailer_sender_domains")
        .select("*")
        .eq("id", body.domain_id)
        .maybeSingle();
      if (!row) return jsonResp({ error: "Not found" }, 404);
      if (!row.resend_domain_id) return jsonResp({ error: "No Resend id on file" }, 400);

      // Resend: POST /domains/:id/verify  — triggers a re-check, returns
      // the domain object including current `status` + `records`.
      const result = await resend(`/domains/${row.resend_domain_id}/verify`, {
        method: "POST",
      }) as { status?: string; records?: unknown[] };

      const verifiedAt = result.status === "verified" ? new Date().toISOString() : null;
      await admin.from("mailer_sender_domains").update({
        verified_at: verifiedAt,
      }).eq("id", row.id);

      return jsonResp({ ok: true, status: result.status, records: result.records || [] });
    }

    if (body.op === "remove") {
      if (!body.domain_id) return jsonResp({ error: "domain_id required" }, 400);
      const { data: row } = await admin
        .from("mailer_sender_domains")
        .select("resend_domain_id")
        .eq("id", body.domain_id)
        .maybeSingle();
      if (row?.resend_domain_id) {
        // Best-effort: if Resend already dropped it (404) that's fine.
        await resend(`/domains/${row.resend_domain_id}`, { method: "DELETE" })
          .catch(() => null);
      }
      await admin.from("mailer_sender_domains").delete().eq("id", body.domain_id);
      return jsonResp({ ok: true });
    }

    return jsonResp({ error: `Unknown op: ${body.op}` }, 400);
  } catch (e) {
    return jsonResp({ error: String((e as Error).message || e) }, 500);
  }
});
