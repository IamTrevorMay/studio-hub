---
title: The api/ Layer — Express Dev Server + Vercel Serverless Functions
last_updated: 2026-07-15
tags: [backend, api, express, vercel, serverless, triton, broadcast]
---

# The `api/` Layer

There are **two** backends in this repo. Most server work is **Supabase edge functions**
(`supabase/functions/`, Deno — see `01-edge-function-anatomy.md`). The `api/` directory is the
**second, separate** backend: Node/Express handlers that run as **Vercel serverless functions** in
production and as a **local Express server** (`api/server.js`, port 4400) in dev. Different runtime
(Node, not Deno), different deploy (Vercel functions, not `supabase functions deploy`), different auth
model. Don't confuse the two.

Use `api/` for things that need Node libraries, a persistent-ish dev server, or a Vercel-native
route: the **PostShow/broadcast** tooling, the **Triton** read-only proxies, public marketing routes
(`careers`, `sitemap`), and NAS/Drive helpers.

## Dual nature: same file, two runtimes

Every handler is written **Vercel-style**:
```js
module.exports = async (req, res) => { /* ... */ res.json(...) }
```
- **In production:** Vercel serves each `api/**/*.js` as an individual serverless function at its path
  (`api/broadcast/projects.js` → `/api/broadcast/projects`). No Express, no router table.
- **In local dev:** `api/server.js` is an Express app that **mounts the same handlers** so you exercise
  the identical code path (`node api/server.js` → `http://localhost:4400`, `/health` for a ping).

`api/server.js` (77 lines) is dev-only glue:
- Mounts `routes/*` Express routers when present — `nas` (always), and `videos`/`drive`/`discord`/
  `kanban` via `tryRequire` (optional, load-if-present) (`api/server.js:11-32`).
- Mounts Vercel-style single handlers: `pitch-video`, `triton-search` (`:35-44`).
- **Auto-mounts every `api/broadcast/*.js`** at `/api/broadcast/<slug>` by reading the dir at boot —
  add a file, it's routed, no manual table (`api/server.js:50-64`). This is the pattern to copy when
  adding a broadcast endpoint.
- Global error handler returns `500 { error: err.message }` (`:67-70`).

**Consequence:** a new broadcast endpoint = drop `api/broadcast/<name>.js` exporting
`async (req,res)=>{}`. It's auto-served in prod by Vercel and auto-mounted in dev by server.js. Nothing
else to wire.

## Directory map

```
api/
  server.js              # dev-only Express host (port 4400), auto-mounts handlers
  package.json           # SEPARATE npm project (own node_modules) — express, cors, dotenv, tus, etc.
  .env / .env.example    # api-layer secrets (NOT the CRA .env) — Triton keys, NAS, Drive
  SETUP.md               # api-layer setup notes
  _lib/                  # shared helpers for the handlers
    tritonProxy.js       #   → the read-only Triton Supabase project
    imagineRenderer.js   #   → image/render helper
    broadcast/           #   → shared broadcast helpers
  routes/                # Express routers (dev): nas, + optional videos/drive/discord/kanban
  broadcast/             # Vercel-style handlers, auto-mounted at /api/broadcast/<slug>:
    projects, scenes, scene-assets, assets, sessions, clip-markers,
    chat-messages, project-members, widget-state, upload, trigger
  imagine/               # imagine (image-gen) serverless handlers
  careers.js             # public careers page/data (rewritten from /careers)
  sitemap.js             # public sitemap.xml
  pitch-video.js         # Triton pitch-video archive proxy (TRITON_PITCH_VIDEO_KEY)
  triton-search.js       # Triton player search (PlayerSearchField + Find Assets modal)
  triton-cron.js         # Triton-side scheduled proxy
  triton-mcp.js          # Triton MCP bridge
  headshot.js, league-baseline.js, scene-stats.js, get-google-token.js
```

`api/` has its **own `package.json` + `node_modules`** — it is a separate Node project from the CRA
app at repo root. Its deps (express, cors, dotenv, tus) are not the app's deps.

## Triton proxies — why they live here

Triton is the **read-only** second Supabase project (briefs, cards, player/pitch assets — see
`Anna/architecture/04-supabase-schema-map.md`). The frontend must never hold Triton credentials, so
the `api/` layer proxies them server-side: `triton-search.js`, `triton-cron.js`, `triton-mcp.js`,
`pitch-video.js`, all going through `_lib/tritonProxy.js`, reading `TRITON_SUPABASE_URL` /
`TRITON_SUPABASE_ANON_KEY` / `TRITON_PITCH_VIDEO_KEY` from `api/.env`. Client callers:
`PlayerSearchField` and the Beat Sheets **Find Assets** modal. The client-side mirror helper is
`src/lib/tritonMcp.js` (which calls these endpoints, not Triton directly).

## Routing — `vercel.json`

```jsonc
{ "rewrites": [
  { "source": "/careers",       "destination": "/api/careers" },
  { "source": "/careers/(.*)",  "destination": "/api/careers" },
  { "source": "/sitemap.xml",   "destination": "/api/sitemap" },
  { "source": "/((?!api/|static/|.*\\.[a-zA-Z0-9]+$).*)", "destination": "/index.html" }
]}
```
- Public marketing routes get clean URLs (`/careers`, `/sitemap.xml`) rewritten to their handlers.
- The last rule is the **SPA fallback**: everything that isn't `/api/*`, `/static/*`, or a file with an
  extension serves `index.html` so React Router (the hand-rolled `activeTab` router — see
  `architecture/01`) owns client routing. **Anything under `/api/` bypasses the SPA** and hits a
  serverless function.

## How the frontend calls it

Same-origin relative paths — no base URL, no `proxy` field in `package.json`. Example:
`src/pages/tools/broadcast/api.js:34-38` calls `/api/broadcast/projects` (GET/POST/PATCH/DELETE with
`?id=`). `tusUpload.js` posts resumable uploads to `/api/broadcast/upload`; `ProducerConsole.js`
fires `/api/broadcast/trigger`. In production these resolve to Vercel functions; in local dev you must
have `node api/server.js` running on :4400 (the client hits the same relative path — ensure your dev
setup routes `/api` to 4400, or run against a deployed preview).

## Auth model — READ THIS (different from edge functions)

The `api/` handlers do **not** share the `shared/handler.ts` `createHandler` wrapper or the edge
functions' CRON_SECRET/JWT conventions — that's a Supabase-Deno construct. Each `api/` handler
enforces its own auth (or is deliberately public, e.g. `careers`, `sitemap`). **When adding or
reviewing an `api/` handler, do not assume a gate exists** — check the handler itself. A serverless
function that mutates data or proxies privileged Triton access must validate the caller (Supabase JWT
passed in the `Authorization` header, or a shared secret) inside the handler. Treat an ungated
mutating `api/` endpoint as a **BLOCKER**, same as an ungated edge function
(`Anna/review/02-security-review.md`).

## Gotchas

- **Two `.env` files.** `api/.env` (Triton/NAS/Drive/serverless secrets) is separate from the CRA
  root `.env` (Supabase anon key etc.). Neither is committed. Setting a Triton key in the wrong `.env`
  is a common dev-time miss.
- **`routes/*` are optional in dev** (`tryRequire`) — a missing `routes/videos.js` silently no-ops
  locally but the corresponding prod function may still exist (or not). Confirm before assuming a
  route is live.
- **Local dev requires the Express server running** for any `/api/*` call the CRA dev server doesn't
  otherwise proxy. If broadcast/Triton features "do nothing" locally, check `:4400` is up
  (`GET /health`).
- **`api/node_modules`** shows up as its own dependency tree — normal; like root `node_modules`, don't
  commit churn.
