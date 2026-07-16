---
title: Build, Deploy & Vercel
last_updated: 2026-07-15
tags: [architecture, build, deploy, vercel, craco, migrations, env]
---

# Build, Deploy & Vercel

How the app is built, where each piece deploys, and the traps (migration
divergence, secrets, the three-runtime layout).

## Three deploy targets

The repo ships **three** distinct runtimes:

1. **React SPA** → Vercel (static build).
2. **Supabase edge functions** (Deno) → Supabase (`supabase functions deploy`).
3. **Vercel serverless functions** (`api/*.js`, Node) → Vercel (auto from `api/`).

Plus a **local-only** Express API (`api/server.js`) used in dev for Post-Show /
broadcast routes.

## Frontend build (CRA + Craco)

Scripts (`package.json:68-78`):

```
npm start            # craco start  — dev server
npm run build        # CI=true craco build  — production bundle
npm run test         # craco test
npm run lint:styles  # node scripts/lint-styles.js  — style-token lint
```

- **Craco** (`@craco/craco`) wraps Create React App (`react-scripts@5.0.1`) so
  the webpack config can be patched without ejecting.
- `craco.config.js` does two things:
  1. **Scopes Tailwind PostCSS to `doc-editor` only** (`:20`) — `isTailwind =
     file.includes('doc-editor')`. Every other file gets plain PostCSS, which is
     why the rest of the app uses inline styles and cannot use Tailwind classes.
  2. Silences `Critical dependency` warnings from `node_modules`
     (`ignoreWarnings`).
- `CI=true` on build turns CRA warnings into non-fatal (build still succeeds
  despite eslint warnings).

### Dev proxy (`src/setupProxy.js`)

The CRA dev server proxies `/api/*` → `http://localhost:4400`
(`LOCAL_API_URL`), so the local Express server (`api/server.js`) serves
Vercel-style handlers during development. In production Vercel serves `/api/*`
directly.

## Vercel

- **Static SPA**: Vercel runs `npm run build`, serves `build/`. The SPA rewrite
  in `vercel.json` sends any non-asset, non-`/api` path to `/index.html` (client
  routing).
- **Rewrites** (`vercel.json`):
  - `/careers` + `/careers/*` → `/api/careers` (SSR `<head>` for job listings).
  - `/sitemap.xml` → `/api/sitemap`.
  - catch-all → `/index.html`.
- **Serverless functions** (`api/*.js`) run on Vercel Node runtime. Examples:
  `careers.js` (server-renders JobPosting JSON-LD so Google for Jobs / LinkedIn
  index listings; the React SPA still hydrates for humans), `sitemap.js`,
  `triton-*.js`, `imagine/`, `headshot.js`, `pitch-video.js`,
  `league-baseline.js`, `scene-stats.js`. These read env at runtime
  (`SUPABASE_URL` / `SUPABASE_ANON_KEY`, or the `REACT_APP_*` fallbacks).
- Deployment details (project, domains — `mmcreate.io`, `maydaystudio.net`) are
  in the `project_deploy` memory. Push to the connected branch triggers a Vercel
  build.

## Supabase edge functions

Deno-based, deployed individually:

```
supabase functions deploy <name> --no-verify-jwt
```

`--no-verify-jwt` because functions do their own auth (cron secret or
user-scoped client) — see `05-edge-functions-catalog.md`. Secrets are set with
`supabase secrets set` / the dashboard, never committed.

Edge-function + DB tests:

```
npm run test:edge   # deno test supabase/functions/ --allow-env --allow-net --allow-read --no-check
npm run test:db     # runs supabase/tests/run-db-checks.sql against the linked project
npm run test:all    # frontend + edge + db
```

## Database migrations — **do not `db push`**

> ⚠️ Local migration history has **diverged** from remote. Running
> `supabase db push` will fail or apply the wrong diff.

Apply schema changes with the **Supabase MCP `apply_migration` tool** (or
`list_migrations` to inspect state). This is the standing rule from the
`project_supabase_migration_divergence` memory and `CLAUDE.md`.

- Migrations live in `supabase/migrations/` (`YYYYMMDDHHMMSS_name.sql`,
  358 files). Still write the `.sql` file for history, but apply it via MCP.
- Cron jobs are armed inside migrations via `cron.schedule` + `net.http_post`,
  pulling the secret from `vault.decrypted_secrets` (see
  `05-edge-functions-catalog.md`).
- `supabase/config.toml` sets `project_id = "Mayday-Studio"`; local API on
  `54321`. Local dev of functions/DB is possible but the primary workflow is
  remote via MCP.

## Environment variables & secrets

- Frontend needs (`.env`, injected at build by CRA):
  `REACT_APP_SUPABASE_URL`, `REACT_APP_SUPABASE_ANON_KEY`,
  `REACT_APP_TRITON_SUPABASE_URL`, `REACT_APP_TRITON_SUPABASE_ANON_KEY`.
  Only `REACT_APP_*` vars reach the browser bundle.
- `.env`, `.env.*`, `api/.env`, `*-service-account.json`,
  `google-drive-account.json` are **git-ignored** (`.gitignore:4-14`).
  `!.env.example` is the committed template. **Never commit secrets.**
- Edge-function / serverless secrets (`SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`,
  `ANTHROPIC_API_KEY`, `METRICOOL_*`, OAuth tokens, `PLAID_*`, `RESEND_*`,
  `CLOUD_API_*`) live in Supabase secrets / Vercel env, not in the repo.
- **Known leak**: an old `CRON_SECRET` is in the git history of
  `20260328200001_cron_generate_trends.sql`. It has been rotated + moved to
  Vault; the stale value in history is inert.

## Commit / push policy

Per `CLAUDE.md` and the `feedback_no_auto_commit` memory: **never** `git commit`
or `git push` without an explicit request from Trevor. `node_modules/` churn in
`git status` is normal local package drift — do not stage or commit it. Automated
branches use the `claude/*` prefix.

## Misc build artifacts

- `scripts/lint-styles.js` — enforces the design-token style system (flags
  hardcoded hex/rgba + off-scale spacing/radii/font-size literals); run via
  `npm run lint:styles`. Note: the `mayday/no-style-magic-numbers` ESLint rule
  named in `styleTokens.js:4` is *not* wired into any eslint config — this script,
  not ESLint, is the actual enforcement.
- `scripts/build-ashley-brain.py` — builds the Ashley agent's knowledge base
  (parallel to this Anna doc set).
- `src/config/`, `src/utils/`, `src/__tests__/`, `src/__mocks__/` — supporting
  config, helpers, and the Jest/RTL test scaffold.
