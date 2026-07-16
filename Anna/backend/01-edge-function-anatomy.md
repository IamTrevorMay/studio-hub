---
title: Anatomy of a Mayday Studio Edge Function
last_updated: 2026-07-15
tags: [backend, edge-functions, deno, supabase, auth]
---

# Anatomy of a Mayday Studio Edge Function

Every edge function lives in `supabase/functions/<name>/index.ts` and runs on Supabase's Deno edge runtime. There are **99** of them (100 dirs in `supabase/functions/`, one of which is the non-deployable `shared/` module — see `../architecture/05-edge-functions-catalog.md` for the full census). They fall into a handful of recognizable shapes, but they all share the same skeleton: CORS handling, an auth gate, a service-role Supabase client, a JSON request/response contract, and a `try/catch` that returns a JSON error. This doc documents that skeleton against real functions so you can write a new one that matches the house style.

## The two entrypoint styles

There are two ways functions bind the HTTP handler, and they are used interchangeably:

- **`Deno.serve(...)`** — the newer built-in. Used by `run-automations`, `generate-trends`, `google-calendar-sync`, `assistant-summary`, `generate-ashley-read`.
  ```ts
  import "jsr:@supabase/functions-js/edge-runtime.d.ts";
  import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
  Deno.serve(async (req: Request) => { ... });
  ```
  (`run-automations/index.ts:7-8,507`)

- **`serve(...)` from `std/http`** — the older import, still common in `sync-*` functions.
  ```ts
  import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
  serve(async (req) => { ... });
  ```
  (`sync-youtube/index.ts:1,169`; `metricool-posts/index.ts:3,13`)

Both behave identically. Prefer `Deno.serve` for new functions.

## CORS: the common block

Nearly every function opens with a `corsHeaders` object and short-circuits the preflight:

```ts
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
// inside the handler:
if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
```
(`google-calendar-sync/index.ts:4-8,127-129`; `generate-trends/index.ts:10-15`)

Two variations worth knowing:

- Functions that accept a cron secret in a header add `x-cron-secret` to `Allow-Headers` (`run-automations/index.ts:10-15`, `generate-ashley-read`).
- Functions that expose **admin-level PII to a browser** restrict the origin instead of using `*`. `assistant-summary` (which powers `assist.mmcreate.io`) reflects only allowlisted origins and sets `Vary: Origin`:
  ```ts
  const ALLOWED_ORIGINS = new Set([
    "https://assist.mmcreate.io", "http://localhost:3000", ...
  ]);
  // "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://assist.mmcreate.io"
  ```
  (`assistant-summary/index.ts:21-36`)

## Auth: three patterns

Functions authorize in one of three ways depending on who calls them.

### 1. Admin JWT only (user-triggered, admin-gated)
The caller passes their Supabase session `Authorization: Bearer <jwt>`. The function makes an **anon client scoped to that header**, calls `auth.getUser()`, then looks up the profile role. `metricool-posts` is a clean example — it gates because the response includes creator-email PII:

```ts
const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY,
  { global: { headers: { Authorization: authHeader } } });
const { data: { user } } = await userClient.auth.getUser();
// then check profiles.role === 'admin'
```
(`metricool-posts/index.ts:26-40`; `google-calendar-sync/index.ts:140-170`)

Note: `is_admin()` in SQL treats `director_creative`/`director_comms` as admin-tier (see doc 02), but most edge functions check `role === 'admin'` **literally** in TypeScript. Don't assume the two are equivalent.

### 2. CRON_SECRET *or* admin JWT (dual-mode: cron + manual refresh)
This is the dominant pattern for anything with a scheduled run that admins can also fire manually ("Refresh" buttons). The secret can arrive as `?secret=` query param or `X-Cron-Secret` header. `generate-trends` and `sync-youtube` both do this:

```ts
const cronSecret = url.searchParams.get("secret") || req.headers.get("x-cron-secret");
const expectedSecret = Deno.env.get("CRON_SECRET");
if (expectedSecret && cronSecret === expectedSecret) {
  // cron path — no user context
} else if (authHeader) {
  // validate JWT + require admin role
} else {
  return 401;
}
```
(`generate-trends/index.ts:23-60`; `sync-youtube/index.ts:171-187`; `run-automations/index.ts:516-554`)

`run-automations` adds a wrinkle: **event mode** (synthesizing tasks from a `new_video` etc.) is restricted to cron callers only, because an admin JWT hand-firing arbitrary events could forge trigger-driven tasks (`run-automations/index.ts:580-582`).

### 3. `--no-verify-jwt` at deploy time
All of these functions are deployed with `--no-verify-jwt` so that the platform gateway does **not** enforce a JWT — the function's own code decides. This is why every function must self-authorize; there is no gateway safety net. The deploy command is written in the file header comment of most functions:

```ts
// Deploy: supabase functions deploy run-automations --no-verify-jwt
```
(`run-automations/index.ts:5`; `assistant-summary/index.ts:14`; `metricool-posts/index.ts:2`)

59 of the 99 functions carry a `no-verify-jwt` marker in a header comment (the rest are deployed with the same flag but don't annotate it). There is a `supabase/config.toml` but it does not set per-function `verify_jwt`; the flag is applied at deploy.

## The service-role client

After authorizing, functions create a **service-role client** that bypasses RLS to do their real work:

```ts
const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
```
(`run-automations/index.ts:556-559`; `generate-trends/index.ts:70-73`)

The `sync-*` family factors this into a shared helper, `getSupabaseAdmin()`, which also throws if env is missing:

```ts
// supabase/functions/sync-youtube/shared/utils.ts
export function getSupabaseAdmin() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key);
}
```
(`sync-youtube/shared/utils.ts:3-8`)

`assistant-*` functions use `getAdminClient()` / `getUserFromJwt()` from `../shared/workflow-engine.ts` (`assistant-summary/index.ts:17,51-55`).

**Rule of thumb:** validate identity with an anon/JWT-scoped client; do all data work with the service-role client. Never mix.

## Environment variables (full inventory)

These are the env vars actually read across the functions, by frequency (`Deno.env.get(...)`):

| Var | Used by | Purpose |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` | ~all | client construction |
| `CRON_SECRET` | 37 fns | cron/trigger auth shared secret (also in Vault as `cron_secret`, see doc 02/03) |
| `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` | generate-trends, generate-ashley-read, assistant-*, generate-*-report, categorize-backlog | Claude calls; `CLAUDE_MODEL` defaults to `claude-sonnet-4-6` |
| `CLAUDE_MODEL_ONEPAGER` | generate-brief-onepager | model override for one-pagers |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_DRIVE_REFRESH_TOKEN` | google-*, drive-* | Google OAuth + Drive |
| `YOUTUBE_API_KEY`, `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN[_MAYDAY]` | sync-youtube | YouTube Data + Analytics |
| `METRICOOL_TOKEN`, `METRICOOL_USER_ID`, `METRICOOL_BLOG_ID` | sync-metricool, metricool-posts, metricool-stories | Metricool API |
| `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`, `PLAID_CUTOVER_DATE` | plaid-* | Plaid banking feed |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | sync-stripe | Stripe revenue |
| `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` | sync-twitch | Twitch |
| `META_ACCESS_TOKEN` | post-daily-graphics | Meta/IG/FB Graph API (posting graphics). No `sync-meta` fn exists — IG/FB metrics come via sync-metricool |
| `FOURTHWALL_USERNAME`, `FOURTHWALL_PASSWORD` | sync-fourthwall | merch |
| `CLOUD_API_URL`, `CLOUD_API_KEY` | cloud-folders | NAS asset service (`assets.maydaystudio.net`) |
| `SHADE_API_KEY`, `SHADE_DRIVE_ID` | shade-search | Shade asset search |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `MAILER_*`, `VAPID_KEYS_JWK` | mailer-*, send-notification-email, send-push | email + web push |
| `TRITON_SUPABASE_URL`, `TRITON_SUPABASE_SERVICE_ROLE_KEY`, `TRITON_URL`, `STUDIO_TRITON_SECRET` | brief/card sync | read-only Triton project |
| `TURNSTILE_SECRET`, `OAUTH_STATE_SECRET`, `JOBS_CONSENT_VERSION` | jobs-*, oauth | jobs portal |
| `SITE_URL` / `SITE`, `ENVIRONMENT`, `WORKFLOWS_DISABLED` | various | env/config toggles |

Secrets are set via `supabase secrets set` (edge function secrets), **not** committed. The `.env` file holds only client-side Supabase keys.

## Request / response contract

- **Request:** `POST` with a JSON body. Functions read `await req.json()` (wrapped in `try/catch` — an empty body is legal for cron mode, `run-automations/index.ts:561-566`). Some `sync-*` and `google-*` functions take control params via query string (`?channel=`, `?mode=`, `?secret=`) — `sync-youtube/index.ts:193-195`.
- **Response:** always `new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } })`. Many functions define a small `jsonResp(body, status)` helper (`run-automations/index.ts:17-22`; `generate-ashley-read`). The `sync-*` family uses shared `jsonResponse()` / `errorResponse()` from `shared/utils.ts`.
- **Status codes in the wild:** `401` unauthenticated, `403` wrong role / event-mode-without-secret, `400` bad input, `404` not found, `405` wrong method, `500` internal, `502` upstream (Claude / third-party API) error (`generate-trends/index.ts:194-215`).

## Error handling

The outer handler is a `try/catch` that logs and returns a JSON `{ error }` with status 500:

```ts
} catch (err) {
  console.error("sync-youtube fatal error:", err);
  return errorResponse((err as Error).message);
}
```
(`sync-youtube/index.ts:698-701`; `generate-trends/index.ts:251-256`; `assistant-summary/index.ts:157-160`)

Note `assistant-summary` deliberately returns a generic `"Internal error"` string to the client and logs the real error — it handles admin data and doesn't leak internals. `sync-*` functions additionally wrap **per-account** work in inner try/catch so one bad account doesn't fail the whole run, recording failures via `failIngestionLog()` (`sync-youtube/index.ts:687-690`).

## Timezone note (appears everywhere)

The runtime is UTC but the business timezone is Pacific. Functions that write date-keyed rows carry a `ptDayString()` helper using `Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" })` so daily rows land on the right PT calendar day (`generate-trends/index.ts:4-8`; `sync-youtube/index.ts:20-24`; `run-automations/index.ts:88-99`). See the `ptDate` pattern — replicate it, don't invent your own.

## Canonical template

```ts
// supabase/functions/my-function/index.ts
// <one-line purpose>
// Deploy: supabase functions deploy my-function --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResp(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResp({ error: "Method not allowed" }, 405);

  // ── Auth: CRON_SECRET or admin JWT ─────────────────────────────
  const url = new URL(req.url);
  const cronSecret = url.searchParams.get("secret") || req.headers.get("x-cron-secret");
  const expectedSecret = Deno.env.get("CRON_SECRET");
  const authHeader = req.headers.get("Authorization");

  let isCron = false;
  if (expectedSecret && cronSecret === expectedSecret) {
    isCron = true;
  } else if (authHeader) {
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error } = await userClient.auth.getUser();
    if (error || !user) return jsonResp({ error: "Not authenticated" }, 401);
    const admin0 = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: profile } = await admin0.from("profiles").select("role").eq("id", user.id).single();
    if (profile?.role !== "admin") return jsonResp({ error: "Admin only" }, 403);
  } else {
    return jsonResp({ error: "Not authenticated" }, 401);
  }

  // ── Service-role client for real work ──────────────────────────
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const body = await req.json().catch(() => ({}));
    // ... do work ...
    return jsonResp({ ok: true });
  } catch (err) {
    console.error("my-function error:", err);
    return jsonResp({ error: (err as Error).message }, 500);
  }
});
```

Deploy with:
```
supabase functions deploy my-function --no-verify-jwt
```
Set any new secrets with `supabase secrets set MY_VAR=...`. If the function is called by pg_cron/triggers, it must accept `CRON_SECRET` and you register the cron job in a migration (doc 02/03).
