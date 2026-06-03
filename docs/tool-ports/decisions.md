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

| Phase | Scope | Deliverable |
|---|---|---|
| 0 | Decisions + this doc | committed |
| 0.5 | Bump `lucide-react` to v1.14 + icon audit | separate commit |
| 1 | 7 scaffold tool pages + nav stubs | in progress |
| 2 | Imagine (smallest BUILD-NOW) | including Deno skia renderer edge fn |
| 3 | Report Cards | install plotly/recharts/html2canvas-pro |
| 4 | Emails (large; DB + Resend + cron + tracking) | 7 tables, ~11 edge fns, dual-run setup |
| 5 | Broadcast (largest; producer role + email-keyed ACL) | 9 tables, 11 Vercel routes, OBS + StreamDeck (WebHID + native plugin) + tus |
| 6 | Cleanup (remove external nav stragglers, delete `Tools.js`, etc.) | |

Each phase ends with a manual verification step; no auto-merge.
