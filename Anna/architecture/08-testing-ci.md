---
title: Testing & CI — What Exists, How to Run It, What Gates a Merge
last_updated: 2026-07-15
tags: [architecture, testing, ci, jest, deno, verification]
---

# Testing & CI

Honest headline: **test coverage is thin and there is no CI pipeline.** The only automated gate on
`push` is Vercel's production build (`CI=true craco build` — a compile/lint failure blocks the
deploy). There is **no `.github/workflows/`** — nothing runs the test suites automatically. Tests are
a **manual, local** discipline. Anna should treat "the tests pass" as something she personally ran,
never something CI proved.

This shapes how Anna verifies: because CI won't catch a regression, **verify behavior directly**
(`/verify`, `/run`, exercise the real app) rather than trusting a green suite that may not cover the
path you touched.

## The test scripts (`package.json`)

```jsonc
"test":          "craco test",                        // interactive watch (Jest via CRA)
"test:frontend": "craco test --watchAll=false",       // one-shot frontend run
"test:edge":     "deno test supabase/functions/ --allow-env --allow-net --allow-read --no-check",
"test:db":       "cat supabase/tests/run-db-checks.sql | npx supabase db query --linked",
"test:all":      "npm run test:frontend && npm run test:edge && npm run test:db",
"lint:styles":   "node scripts/lint-styles.js",       // the REAL style enforcer (see below)
```

There is **no `jest` block in `package.json`** and no `jest.config.js` — Jest config is whatever CRA
(`react-scripts`, driven through `@craco/craco`) provides by default. No `proxy` field either.

### Frontend tests — Jest + React Testing Library

- Runner: `craco test` (CRA's Jest wrapper). Deps: `@testing-library/react`, `@testing-library/jest-dom`.
- **What actually exists** (`src/__tests__/`, 4 files only):
  - `contexts/ConfirmContext.test.js`
  - `hooks/useSupabaseQuery.test.js`
  - `hooks/useNavConfig.test.js`
  - `hooks/useVisibilityRefresh.test.js`
- **Zero page-component tests.** The giant pages (`Deliverables.js`, `Production.js`, …) have no
  coverage. Hooks and one context are the only tested units.
- **Supabase mock:** `src/__mocks__/supabaseMock.js` exports `createMockSupabase(mockData, mockError)`
  — a **chainable Proxy** where every query method returns itself and `await` resolves to
  `{ data, error }`, plus a stubbed `auth` (getSession/refreshSession/getUser/onAuthStateChange) and a
  realtime channel stub. Use it to unit-test anything that calls `supabase.from(...).select()...`:
  ```js
  jest.mock('../../supabaseClient', () => ({ supabase: createMockSupabase([{ id: 1 }]).supabase }));
  ```
  Model new hook/context tests on the existing four — same mock, same RTL patterns.

### Edge-function tests — Deno

- `test:edge` runs `deno test` across `supabase/functions/` with `--no-check` (types not enforced).
- **Reality:** there are currently **no `*.test.ts` files** in `supabase/functions/` — the command
  runs clean because it finds nothing. If Anna adds edge-function logic worth testing, she is writing
  the *first* Deno tests; put them beside the function (`supabase/functions/<name>/*.test.ts`) using
  `Deno.test(...)` so `test:edge` picks them up. Prefer testing pure helpers (parsing, date math,
  dedup-key resolution) over anything needing a live Supabase.

### DB checks

- `test:db` pipes `supabase/tests/run-db-checks.sql` through `supabase db query --linked` — assertion
  SQL run against the **linked remote** (there is no local stack in this workflow). Add invariant
  checks (RLS present on new tables, no orphan FKs, expected constraints) to that file.
- Caveat: `--linked` hits the real project. Keep checks **read-only** — no mutations in the checks file.

## `lint:styles` — the only enforced code standard

`scripts/lint-styles.js` (run via `npm run lint:styles`) is the **real** enforcer of the
tokens-over-hardcoded-values rule. It is a **standalone Node script, not an ESLint rule** — the
`mayday/no-style-magic-numbers` rule named in the `styleTokens.js:4` comment **does not exist** and is
wired into no eslint config (see `Anna/review/03-style-compliance.md`). Nothing runs `lint:styles`
automatically either — it's manual. When Anna touches styling, she should run it herself.

## What gates a merge / deploy — the honest picture

| Gate | Automatic? | Catches |
| --- | --- | --- |
| `CI=true craco build` on Vercel push | ✅ yes (blocks deploy) | Compile errors, unresolved imports, CRA lint-as-error |
| `npm run test:all` | ❌ manual | The 4 hook/context units + (future) edge/db checks |
| `npm run lint:styles` | ❌ manual | Hardcoded style values |
| Human review / `/code-review` | ❌ manual | Everything else — the real safety net |

**Implication for Anna:** the build catches "does it compile," nothing catches "does it behave."
Correctness is on the author. Always mirror mobile + desktop twins, run the app for anything
user-visible, and state exactly what you verified — a passing build is not a passing feature.

## If asked to "add CI"

None exists to extend — you'd be creating `.github/workflows/` from scratch. A minimal first pass:
run `npm run test:frontend` + `npm run lint:styles` on PR (fast, no secrets), and leave `test:edge` /
`test:db` for later since `test:db` needs a linked project + secret. Flag that `test:db --linked`
should point at a branch/preview DB, never production, before it's automated.
