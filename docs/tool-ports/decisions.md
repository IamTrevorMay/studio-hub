# Triton-Tools → Mayday Studio Port: Locked Decisions

Captures all 50 Q/A from the planning round + 4 re-confirmed flags. Treat as
the source of truth for the port; any conflicting later instruction wins,
but call out the conflict here when it does.

Plan reference: see the session transcript (50 questions, grouped) — this
doc is the consolidated answer.

---

## Scope

- **Broadcast** = `app/(broadcast)/` in Triton-Tools (operator view +
  `/producer/[sessionId]`). Producer view ported into Mayday.
- **scene_builder** existing nav row (external Triton deep-link) → replaced
  by scaffold stub. Stub shows "Coming soon" + a deep-link button to
  Triton's live version meanwhile.
- **broadcast** existing nav row (external Triton URL) → replaced by the
  in-app port once shipped. During Phase 1 it points at a scaffold stub.
- `src/pages/Tools.js` deleted (AppLayout owns routing).
- Asset Designer + Scene Composer + Template Builder logically grouped
  under a "Design" folder. Folder organization is admin-editable via the
  existing nav config UI — not hardcoded.

## Data ownership

| Tool | Data location | Migration |
|---|---|---|
| Broadcast | **Mayday main project** | Port 9 `broadcast_*` tables + storage bucket + 12 edge fns |
| Report Cards | **Mayday main project** | Copy `report_card_templates` table |
| Emails | **Mayday main project** | Export Triton subscribers + audiences, import to Mayday |
| Imagine | **Mayday main project** + **Vercel Node fn** renderer | Port `imagine_history`; build server renderer as a Vercel Node serverless fn (api/imagine-render.js) using @napi-rs/canvas |

**Renderer location pivot (2026-06-02, mid-Phase 2):** The 2F.1 skia spike
proved Supabase Edge Functions cannot host the renderer — that runtime
disallows native FFI, which `skia_canvas` requires. The pivot is to a
Vercel Node serverless function alongside studio-hub's existing `api/`
folder (Vercel already deploys ~6 Node functions there). Uses the same
`@napi-rs/canvas` Triton ships, so the renderer body can be ported nearly
verbatim from Triton's `lib/serverRenderCard.ts` and pixel output matches
Triton's by construction. Mayday UI calls the relative URL
`/api/imagine-render`; `npm start` local dev returns 404 since CRA's dev
server doesn't run Vercel functions (use `vercel dev` or test on a Vercel
preview).

- Broadcast project membership: keyed by **email** match into
  `broadcast_project_members` (since Mayday `profiles.id` ≠ Triton
  `profiles.id`).
- Triton's `daily-cards` cron: unrelated to these 4 tools — left alone.

## Auth + permissions

| Tool | Who can use |
|---|---|
| Broadcast | admin + **new `producer` role** |
| Report Cards | all authenticated users |
| Emails | admin only, entire flow |
| Imagine (labeled "Graphics") | all authenticated users |

- `director_creative` + `director_comms` see all 4 BUILD-NOW tools.
- New `producer` role: not admin-tier; sees member-tier pages + Broadcast.
  Added in Phase 5 (Broadcast) — no producer users yet.
- Per-project Broadcast ACL: email-matched membership rows; admins bypass.

## UI/UX

- Restyle Triton's Tailwind → Mayday `styleTokens` / `styleRecipes`
  (`#0f0f1a` base, indigo `#6366f1` accent).
- Drop Triton chrome (`TRITON APEX / Broadcast` headers, `BroadcastNav`).
  Use Mayday's tool header (`onBack` + tab strip).
- Icons: inline SVG to match `Teleprompter.js`. No lucide imports in
  ported components.
- Imagine: split 1,036-LOC page into Layout + WidgetList + FilterBar +
  PreviewPane + HistoryPane.
- Email preview: keep `<iframe srcdoc>`.
- Report Cards back button: `onBack()` (not `window.history.back()`).

## Dependencies

Approved installs (Mayday `package.json`):
- `obs-websocket-js` (Broadcast)
- `@elgato-stream-deck/webhid` (Broadcast — Chromium-only WebHID)
- `tus-js-client` (Broadcast resumable uploads)
- `plotly.js` + `react-plotly.js` — **lazy-loaded** (Report Cards + Imagine)
- `recharts` (Report Cards bar/donut)
- `html2canvas-pro` (Report Cards PNG export)

Approved bumps:
- `lucide-react` 0.577 → 1.14 with an app-wide icon-rename audit pass
  (separate Phase 0.5 commit).

Deferred:
- `@react-three/fiber` + `three` — Scene Composer is SCAFFOLD; install
  when promoted.
- `@napi-rs/canvas` — node-only; replaced by a Deno-compatible canvas
  library (e.g. `https://deno.land/x/skia_canvas`) inside the Imagine
  render edge fn.

## Storage

- `broadcast-assets` bucket: 5 GB / file cap (Supabase Pro platform max),
  all MIME types. Log every upload >100 MB.
- `email-assets` bucket: public read.
- Asset Designer storage: deferred (decision when SCAFFOLD promoted).

## Naming + nav

- Tool labels (Q38b): **Mailer** / **Report Cards** / **Graphics** /
  **Broadcast**.
- Each tool gets a **unique inline-SVG icon** in the sidebar.
- Mayday's existing inbound RSS / research system stays separate from the
  outbound Emails ("Mailer") tool.
- Nav keys (locked):
  - `broadcast` (reuses existing key — was external)
  - `report_cards`
  - `mailer`
  - `graphics`
  - `asset_designer`
  - `scene_builder` (reuses existing key — was external)
  - `template_builder`

## Infrastructure conventions

- One Supabase edge function per logical endpoint (not a single grouped
  router). Names: `emails-products`, `emails-send`, `emails-track-open`,
  `broadcast-projects`, `broadcast-trigger`, etc.
- Deploy every new edge fn with `--no-verify-jwt`; gate auth in-function
  using the same pattern as the recent `sync-*` hardening.
- Cron: pg_cron + edge fn (Vault for shared secrets). Matches existing
  Mayday convention.
- Cross-project proxy auth (anywhere we still call Triton): bearer
  `CRON_SECRET` header.
- YouTube chat integration from Triton Broadcast: **dropped**.
- Triton MCP server mirror: **dropped** (out of scope for Mayday).
- Triton env vars confirmed present (`REACT_APP_TRITON_SUPABASE_URL`,
  `REACT_APP_TRITON_SUPABASE_ANON_KEY`, `REACT_APP_TRITON_CRON_SECRET`)
  in both local `.env` and Vercel for `studio-hub`.

## Cutover plan

- **Emails**: dual-run with Triton for 30 days so in-flight tracking
  pixels and Resend webhook hits continue to land somewhere. Hard cutover
  of new outbound sends to Mayday on deploy day.
  - Triton-side: leave the existing newsletter scheduled-send cron + the
    `/api/emails/track`, `/api/emails/webhook`, `/api/emails/unsubscribe`
    routes online (read-only-ish — they still record events, but no new
    sends originate). After 30 days, decommission them in one PR.
  - Mayday-side: enable the new `mailer-drain-scheduled-sends` pg_cron
    (`supabase/migrations/20260603200100_cron_mailer_drain.sql`) only
    after swapping `<MAYDAY_VERCEL_HOST>` + `<CRON_SECRET>` placeholders,
    point Resend webhook URL to the Mayday handler, and run a manual
    Triton subscriber pull into a Mayday audience (CSV export from
    Triton dashboard, then bulk-import in the Audiences panel — or set
    `TRITON_SUPABASE_URL/KEY` env + use the Mailer's "Pull from Triton"
    button).
  - Verification before disabling Triton: send one campaign each from
    both systems to a small internal audience, confirm both sides record
    open/click events, then schedule the Triton decommission for
    2026-07-03 (30 days post-cutover).
- **Broadcast**: no live shows in next 2 weeks — free cutover window.
  - Producer role added to `profiles.role`; producers see only the
    Broadcast nav row (plus member-tier defaults). Per-project ACL via
    email-keyed `broadcast_project_members` rows.
  - Storage: `broadcast-assets` bucket (public read, producer-write).
    Files >100 MB log a server-side warning; cap is the Supabase Pro
    platform max (5 GB / file). Uploads use the tus protocol directly
    against `${SUPABASE_URL}/storage/v1/upload/resumable`.
  - Realtime: `broadcast_widget_state` + `broadcast_chat_messages` +
    `broadcast_sessions` published on `supabase_realtime`. Overlay
    subscribes to row updates; ephemeral signals (producer panel
    show/hide) go through Supabase channel `broadcast` events.
  - Public overlay route at `/broadcast-overlay/<channel_name>` is **deferred**;
    `LivePreview` is a placeholder for now. Producer console works
    end-to-end (asset CRUD + trigger + Realtime + OBS WS + StreamDeck WebHID + native plugin).
  - StreamDeck native plugin lives at `streamdeck-plugin/com.mayday.broadcast.sdPlugin/`,
    packaged separately via Elgato's CLI. See `streamdeck-plugin/README.md`.
- **Report Cards / Imagine**: no live cutover risk.

## Re-confirmed flags

1. **Imagine renderer**: build Deno+skia_canvas inside Mayday (chose
   ownership + pixel-diff risk over proxy).
2. **lucide-react bump 1.14**: app-wide icon-rename audit included.
3. **broadcast-assets cap**: platform max (5 GB / file), all MIME,
   log >100 MB.
4. **Producer role**: new value in `profiles.role`; member-tier pages +
   Broadcast; per-project ACL via email-matched
   `broadcast_project_members`.

## Phased plan recap

| Phase | Scope | Status | Branch / commit |
|---|---|---|---|
| 0   | Decisions + this doc | ✅ done | `main` |
| 0.5 | Bump `lucide-react` 0.577 → 1.17 + icon audit | ✅ done | `main` @ `13cb55c2` |
| 1   | 7 scaffold tool pages + nav stubs | ✅ done | `main` @ `02fc07a5` |
| 2   | Imagine (Graphics) — Vercel renderer | ✅ done, pushed | `claude/imagine-port` |
| 3   | Report Cards — Builder + Generator + PNG/PDF | ✅ done, pushed | `claude/report-cards-port` |
| 4   | Mailer — DB + Resend + cron + tracking | ✅ done, pushed (preview) | `claude/mailer-port` @ `475056f0` |
| 5   | Broadcast — producer role + OBS + StreamDeck + tus | ✅ done, pushed (preview) | `claude/broadcast-port` @ `53308f22` |
| —   | Consolidate phases 2–5 onto one branch | ✅ done | `claude/triton-port` |
| 6   | Cleanup (delete `Tools.js`, schedule Triton decom) | ✅ done (on consolidated branch) | `claude/triton-port` |

Each phase ends with a manual verification step; no auto-merge. Branches
hold the work; main is still pre-port aside from Phase 0 / 0.5 / 1.

## Current state (snapshot 2026-06-03)

### Shipped on `main`
- 7 scaffold tool stubs in `src/pages/tools/`
- `lucide-react` bumped to 1.17 with app-wide icon-rename audit pass
- Director-tier roles (`director_creative`, `director_comms`) + role helpers

### Shipped on preview branches (not yet merged)
- **claude/imagine-port** — Graphics tool: imagine_history table, widget
  registry, schema-driven FilterBar, scene-driven Vercel Node renderer
  (`@napi-rs/canvas`, 9 renderer kinds), heatmap-data + league-baseline
  same-origin proxies, history-pane + export flow. Nav row flipped to
  all-authed.
- **claude/report-cards-port** — Report Cards: 6 catalog cards, Builder
  + Generator + canvas-based PNG export + jsPDF + history. Nav row
  flipped to all-authed.
- **claude/mailer-port** — Mailer (Emails port): 7 tables + email-assets
  bucket, 13 Vercel routes (CRUD + send + preview + webhook + tracking +
  unsub + cron + Triton subscriber pull), block editor UI with 15 block
  types, audience manager + CSV bulk import, dual-run with Triton over
  the next 30 days (Triton decommission target: 2026-07-03).
- **claude/broadcast-port** — Broadcast: 9 tables + producer role +
  email-keyed `broadcast_project_members` + `broadcast-assets` bucket,
  11 Vercel routes, producer console with OBS WebSocket + StreamDeck
  WebHID + ClipMarkerPanel + TemplateDataPanel + ChatReplay + tus
  resumable uploads, native StreamDeck plugin scaffold at
  `streamdeck-plugin/com.mayday.broadcast.sdPlugin/`.

### What's untested in this session
- Live Mailer send + Resend webhook + drainer cron (need Vercel preview
  + env vars + Resend dashboard pointed at preview URL).
- Live OBS WebSocket connection from the producer console (browser
  needs OBS Studio + obs-websocket plugin running locally).
- WebHID StreamDeck pairing (Chromium-only).
- Tus upload against the real `broadcast-assets` bucket.
- Native StreamDeck plugin install (needs `images/` PNGs + Elgato CLI
  packaging before distribution).

## What's left

### Pre-merge to main (per branch)
- **Mailer**: env vars on Vercel (RESEND_API_KEY, RESEND_FROM_EMAIL,
  RESEND_WEBHOOK_SECRET, EMAIL_LINK_SECRET, CRON_SECRET, PUBLIC_APP_URL,
  optional TRITON_SUPABASE_URL/KEY). Apply
  `supabase/migrations/20260603200100_cron_mailer_drain.sql` to enable
  the scheduled-send drainer (uses vault `cron_secret`; default host is
  `studio-hub.vercel.app`, swap the URL string if you've bound a custom
  domain). Point Resend webhook URL at preview, verify svix sig.
  Smoke: create product → template → audience → test send → confirm
  open/click events + webhook bookkeeping.
- **Broadcast**: ship the public overlay route at
  `/broadcast-overlay/<channel_name>` (currently `LivePreview` is a
  placeholder). Add StreamDeck plugin images + package via Elgato CLI.
  Smoke: create project → upload asset → fire trigger from web grid →
  confirm Realtime row updates + overlay (once it ships) renders.

### Phase 6 (cleanup, in progress on `claude/triton-port`)
- ✅ `src/pages/Tools.js` deleted (AppLayout owns routing).
- ✅ `receive-newsletter` Supabase edge fn deleted from remote (was still
  ACTIVE on Supabase even though local files were gone — caught in audit
  pass 2026-06-03). `ingest-newsletter` was never deployed remote.
- 📅 **Triton-side email decommission scheduled for 2026-07-03.** Triton
  keeps its `/api/emails/track` + `/api/emails/webhook` +
  `/api/emails/unsubscribe` routes live during the dual-run so in-flight
  tracking pixels don't 404. On 2026-07-03: disable Triton's scheduled
  send cron, archive `newsletter_subscribers`, and remove the routes in
  a single Triton-side PR. Mayday side requires no further code change
  for this step.
- Remove the `Mayday Daily` placeholder stub used during Mailer
  scaffolding, once a real product is created in prod. (Deferred — no
  product seeded yet.)
- External-link nav rows for `broadcast` / `scene_builder` are already
  replaced by the in-app ports on this branch; no further action.

### SCAFFOLD-tier (deferred; promote when needed)
- Asset Designer — storage decision deferred until promoted.
- Scene Composer — needs `@react-three/fiber` + `three`.
- Template Builder — design work pending.

### Open verifications before merging anything to `main`
- Vercel preview deploy boots for both branches (no `api/*` regression).
- Type-checks pass (`npm run build`).
- Manual click-through of each tool's golden path on the preview URL.
- RLS spot-checks: producer-role user can read own broadcast project but
  not someone else's; admin-only Mailer routes 403 for non-admin JWTs.

Each phase ends with a manual verification step; no auto-merge.
