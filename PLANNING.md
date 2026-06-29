# Mayday Studio — Planning

## Recently Completed

### Templates: Beat Sheet + Research Documents (2026-06-13)

- **Beat Sheet templates**: new "New Beat Sheet" modal (name + Blank/template picker, deep-clones template beats with fresh UUIDs), kept in-editor "Save as Template" (full state incl. media) + append-into-open-sheet, added rename action. Migration `20260613000007` makes `beat_sheet_templates` universal (any authed user can update/delete).
- **Research Documents page** (`src/pages/ResearchDocs.js`, key `research_docs`, label "Research", in Pre-Production folder, all roles): lists Google Docs from a shared Drive folder (`16qph…`), "+ New Research Document" copies a template doc (`1F3PfP…`) into the folder and opens it. Rename/delete per row. Backed by new edge function `google-drive-research` (deployed, `verify_jwt=false`, reuses `GOOGLE_DRIVE_REFRESH_TOKEN`). Old RSS/briefs/trends page relabeled "Research" → "News" (key `research` unchanged). `nav_config` updated on remote.
- **TODO — mobile**: the new Research Documents page is desktop-only. It is NOT wired into `AppLayoutMobile.js` (separate page registry + mobile variants like `ResearchMobile.js`). It safely won't appear on mobile rather than break. Needs a mobile variant + route case (`case 'research_docs'`) added eventually.

### Mailer Phase 4 (2026-06-13)

Full Phase 4 port of the Mailer tool from Triton. Admin-only newsletter
system: block-based editor with live preview, audiences, scheduled sends,
open/click tracking, Resend webhooks, sender domain verification, CSV
subscriber import, suppression list, per-campaign stats.

**Phase 4a — Foundation** (commit `619b5542`)
- 8 tables (`mailer_audiences`, `mailer_subscribers`, `mailer_audience_subscribers`, `mailer_campaigns` w/ jsonb `blocks`, `mailer_sends`, `mailer_events`, `mailer_suppressions`, `mailer_sender_domains`) + admin-only RLS + `is_admin()` helper + `mailer_bump_stat()` RPC for atomic counter updates
- Edge functions: `mailer-send-now` (batch via Resend, suppression filter, per-recipient audit rows), `mailer-webhook` (Svix signature verify, status mapping, auto-suppress on bounce/complaint), `mailer-track-open` (1×1 gif w/ dedup), `mailer-track-click` (302 redirect w/ http/https allowlist), `mailer-unsubscribe` (GET confirm page so antivirus scanners don't auto-unsubscribe + POST one-click for Gmail List-Unsubscribe), `mailer-cron-tick` (atomic claim of due scheduled campaigns)
- Shared: `resend.ts` REST wrapper + `mailer-render.ts` block-tree → HTML/text renderer
- UI shell: 4-tab admin page (Campaigns / Audiences / Subscribers / Sends), CRUD wired to tables, status pills, modal editor (initially with raw-JSON blocks textarea)

**Phase 4b — Block editor, CSV, stats, settings** (commit `<pending>`)
- `BlockEditor.js` — visual block list with per-type inline forms (heading / paragraph / image / button / divider / spacer / html), reorder ↑↓, delete, add-block palette
- `CampaignPreview.js` — sandboxed iframe live preview via `srcDoc`
- `blockRenderer.js` — client-side JS mirror of the Deno renderer (kept in sync)
- `CampaignStats.js` — tile dashboard (recipients/delivered/opened/clicked/bounced/complained with %), top clicked URLs leaderboard, recent events log, cohort table
- `CsvImportModal.js` — small RFC4180-ish CSV parser, audience attach, upsert preserves existing subscriber status (re-import never un-suppresses)
- `SettingsPane.js` (new tab) — sender domains CRUD w/ DNS record display + verify, suppression list w/ remove
- Campaign editor rewrite: 3-pane modal (content / settings / stats), datetime-local scheduler, Schedule button flips status to `scheduled`
- `mailer-domain` edge fn — Resend `/domains` proxy (add/verify/remove)
- `cron_mailer_tick` migration — pg_cron `mailer-tick` job every minute, reads `CRON_SECRET` from Vault, POSTs to `mailer-cron-tick`

**Deploys / env still needed**
- `supabase functions deploy mailer-send-now mailer-webhook mailer-track-open mailer-track-click mailer-unsubscribe mailer-cron-tick mailer-domain --no-verify-jwt`
- Secrets: `RESEND_API_KEY`, `MAILER_DEFAULT_FROM`, `MAILER_WEBHOOK_SECRET` (Svix `whsec_…`), `MAILER_PUBLIC_URL` (Supabase project URL)
- Resend dashboard: create webhook → POST to `<project>/functions/v1/mailer-webhook`, subscribe `email.*`
- Confirm `CRON_SECRET` is in Vault (already used by other cron jobs)

### Broadcast hardening (2026-06-12 → 2026-06-13)

Full review pass on the Broadcast page (`src/pages/tools/Broadcast.js` + `src/pages/tools/broadcast/*` + `api/broadcast/*`). 5 critical / 17 high / 6 medium / 5 verify findings closed across commits `c7a24bc8`, `26d171a8`, `29ae8eea`, `379341e0`.

**Security**
- OBS WebSocket password no longer persisted to localStorage (leak grants remote control of user's OBS) — kept in component state only; one-time scrub of legacy entries.
- `api/broadcast/upload`: stopped echoing caller's own JWT back; client attaches Authorization locally.
- `api/broadcast/sessions`: bumped `randomSlug` 6 → 16 base36 chars (~82 bits) so overlay URL isn't brute-forceable.
- `api/broadcast/assets` + `sessions`: explicit security comments confirming public GET is intentional (overlay runs inside OBS browser source with no auth).
- `LivePreview.js` iframe sandboxed (`allow-scripts` only, opaque origin) so overlay can't reach producer console DOM/cookies.
- `OBSSettings.js` inputs: `autoComplete="off"` so browser credential managers don't save the OBS WebSocket password.

**Correctness**
- Realtime channels now `channel.unsubscribe()` before `removeChannel` (was leaking handlers).
- `api.js` `request()` + `trigger()` accept `opts.signal`; `trigger()` now checks `response.ok` instead of silently parsing error JSON.
- `useObs`: `connectTokenRef` invalidates in-flight `connect()` on cred change / unmount.
- `AssetLibrary`: capture `project.id` at dispatch time so uploads can't land in the wrong project; per-upload AbortController + mountedRef guard.
- `TemplateDataPanel`: 400ms debounce + AbortController per save; asset switch and unmount cancel pending PATCHes.
- `api/broadcast/trigger`: state update guarded `.eq('is_live', true)` + row-count check → 409 if session went offline mid-flight.
- `ScenesPanel` / `ClipMarkerPanel` / `MembersPanel`: explicit snapshot rollback on optimistic update failures.
- `LiveControlGrid:35`: wrapped `(a.hotkey_color || on)` (precedence bug — unselected no-color tiles were grabbing `colors.text`).
- `useStreamDeck`: track + remove device `.on('down'/'up'/'error')` listeners on re-attach + close + unmount.
- `OBSSettings`: scoped effect deps to `obs.status` + memoized `obs.call` (was re-running every parent render).
- `AssetProperties`: replace `JSON.stringify` equality with `EDITABLE_KEYS` shallow compare; gate post-PATCH state update on `activeAssetIdRef` so a save started for asset X can't paint a "Saved" badge against asset Y.
- `AssetsPanel`: snapshot selection before `load()` in both `onCreated` and `onSaved` — user's manual selection mid-flight isn't clobbered by the freshly-uploaded/saved row.
- `tusUpload`: detach the AbortController `abort` listener once the upload settles.

**Dev infrastructure** (commit `c028f966`)
- `api/server.js` auto-mounts every Vercel-style handler in `api/broadcast/*` at `/api/broadcast/<file>` so local dev hits the same code path Vercel runs in prod.
- `src/setupProxy.js` (new) forwards `/api/*` from CRA dev (`:3000`) to the Express backend (`:4400`). Local 404s on broadcast routes were caused by both gaps.

### Contractor Assignment UX Enhancements (2026-05-29)
Added three new capabilities to FreelancerDashboard.js for in-progress assignments:

1. **In Progress indicator** — Yellow badge replaces the old "Mark Complete" button when assignment is `in_progress`.
2. **Submit button** — Opens a Google Drive upload modal (reuses `drive-upload-init` edge function pattern). Uploads to contractor's `assigned_drive_folder_id` or falls back to shared `SUBMISSIONS_FOLDER_ID`. After successful upload, captures the Drive file ID from XHR response, constructs the view URL, saves it as `asset_url` on the assignment. Button turns green with checkmark; clicking green Submit auto-completes the assignment.
3. **I'm Stuck button** — Opens an inline text input asking "What are you stuck on?" Posts the message as an assignment comment (prefixed with construction emoji) and sends `fl_stuck` notifications to all admins.

New flow: `assigned → [Start Working] [Decline]` → `in_progress → [● In Progress] [Submit] [I'm Stuck]` → after upload → `[● In Progress] [✓ Submit (green)] [I'm Stuck]` → click green Submit → `completed`.

Hourly contractors still get the hours modal on green Submit click before completion.

### Backend Audit (2026-05-27)
Fixed 12 issues across 11 edge functions, all deployed:

**Critical (fixed)**
- Input sanitization for Drive query injection in `drive-list-clips`, `google-drive-resources`
- Swallowed error on YouTube `audience_snapshots` upsert in `sync-metricool`
- Hardcoded Claude model name in `generate-trends` (now uses `CLAUDE_MODEL` env var)

**Medium (fixed)**
- `shared/utils.ts`: ingestion log updates now check for errors; duplicate detection uses Postgres error code `23505`
- `invite-user`: invitation insert switched from `userClient` to `adminClient` (RLS fix)
- `sync-youtube`: channel slug derived dynamically instead of hardcoded map
- `metricool-create-post`: warns when image normalization returns no mediaId
- `run-report`: quoted UUID in `.or()` filter; hardcoded model name fixed (2 places)
- `drive-upload-init`: Origin header parsed via `new URL()` instead of raw Referer passthrough
- `google-auth-callback`: state param validated with try/catch + type checks

### Calendar Bug Fix (2026-05-27)
Recurring events now appear on any month. Root cause: DB query filtered by `start_date`/`end_date` overlap, excluding recurring events whose original dates were in a prior month. Fix: `or` filter fetches all recurring events regardless of date range.

### Profile Deletion FK Fix (2026-05-25)
Fixed `NO ACTION` FK constraints on `payroll_salaries` and other tables blocking profile deletion. Converted to `ON DELETE CASCADE` / `SET NULL`.

### YouTube Studio Advanced (2026-05-27)
New pages: `ContentHealthDashboard.js`, `YouTubeStudioAdvanced.js`. New edge functions: `sync-youtube-dimensions`, `backfill-youtube-dimensions`. Migration: `20260527000000_yt_studio_advanced.sql`.

### Contractor System (2026-05-25 → 2026-05-29)
Renamed Freelancer to Contractor in admin panel. Added document signing (`DocumentSigner.js`, `DrawingPad.js`), assigned Drive folders, and contract upload flow. Multiple migrations for freelancer tables, notifications RLS, invitation signing flag, and signature columns. Later added edit/delete UI for assignments, and Submit/In Progress/I'm Stuck UX for contractor dashboard.

## Planned

### Near-term
- Supabase CLI update (v2.95.4 → v2.101.0)
- `CLAUDE_MODEL` env var should be set in Supabase dashboard to pin model versions across `generate-trends`, `run-report`

### Pending — Substack subscriber count broken since 2026-03-05 (2026-06-28)

**Symptom:** Analytics subscriber number for the Mayday Substack is frozen at
`2026-03-05` (~3.7 months stale). Articles are fine — `content_items` updates
daily via RSS; only the subscriber metric in `audience_snapshots` is dead.

**Root cause (confirmed via live curl 2026-06-28):**
- `sync-substack` fetches `${baseUrl}/api/v1/subscriber_count`. That public
  Substack endpoint is **gone — returns 404** on both the custom domain
  (`https://www.mayday.show`) and the subdomain (`iamtrevormay.substack.com`
  301-redirects to the 404). Substack removed it ~March, matching the freeze.
- Failure was **silent**: the fetch is wrapped in `try { … } catch { console.log() }`
  (sync-substack/index.ts:62–82) and only upserts on `statsRes.ok`, so the run
  still logged `success` while writing nothing.
- Homepage `_preloads` now exposes only **bucketed** marketing strings
  (`rankingDetailFreeSubscriberCount: "Over 2,000 subscribers"`), no exact number.
- Exact free/paid counts now require an **authenticated** Substack session.

**Decision (Trevor, 2026-06-28):** source exact counts by parsing Substack's
publisher emails via Gmail.

**Inbox investigation — RESOLVED 2026-06-28 (corrected earlier wrong assumption):**
- Substack account/login email IS **`trevormayofficial@gmail.com`** (verified in
  Substack → user profile → Settings → Account). This is the SAME inbox already
  connected to the claude.ai Gmail integration — so samples can be inspected directly.
- Earlier guess that the publication lived under `trevor.may.khs@gmail.com` was WRONG.
  (Both addresses merely *subscribe* to the "The Mayday Catch Up" newsletter, sender
  `iamtrevormay+the-mayday-catch-up@substack.com`; the khs copy auto-trashes.)
- No publisher **stat** emails are present because they are **disabled**, not because
  it's the wrong inbox.
- The Substack publication **Settings → Analytics** section (GA4 `G-4C55G86M3T`, GTM,
  FB/Twitter pixel, Parse.ly, site-verification) is OUTBOUND ad/conversion tracking —
  it does NOT expose free/paid subscriber totals. Not usable for this. (GA4 could later
  feed site *pageviews* via the GA Data API, but that's not on the metric list.)

**The setting to enable (Trevor's action):**
- **Publisher dashboard → Settings tab** (the bottom-left publication settings, NOT
  the profile settings) → notifications/subscribers section → toggle ON
  **"New free subscriber"** and **"New paid subscriber"**.
  Source: support.substack.com/hc/en-us/articles/29152946791188 ("head to the Settings
  tab… toggle on 'New free subscriber'").
- The "Your week on Substack" weekly summary is an automatic writer email (no clean
  toggle) — can't be force-enabled; don't rely on it.

**EMAIL-PARSE APPROACH KILLED 2026-06-29 (verified against a real email).**
Trevor enabled the New free/paid subscriber toggles; a "New free subscriber to Mayday!"
email arrived (no-reply@substack.com → trevormayofficial@). Its body contains ONLY the
new subscriber's email + signup source + a "View dashboard" button — **no running total,
no paid count.** Per-event emails give growth deltas only, can't reconstruct the absolute
total, and don't capture unsubscribes (churn) → a running tally would drift high. So the
"parse email → get total" plan is dead; the data isn't in the email.

**DECISION 2026-06-29: manual periodic entry.** Subscriber/paid totals are slow-moving;
Trevor enters them by hand when he wants.
- Path ALREADY EXISTS — Analytics → Dashboard → **"Data Input" → Substack**
  (`DataInputSection.js:50` → `ManualMetricsForm` with fields
  `['views','revenue','supporters','followers']`):
  - **followers** → `audience_snapshots.followers_total` = total subscribers
  - **supporters** → `audience_snapshots.metadata.supporters` = paid subscribers
- Nothing to build for entry. The new Dashboard digest card reads followers_eod for the
  Substack "Subscribers" number; it updates as soon as a manual entry lands.
- The New free/paid subscriber email toggles can be left on or turned off — no longer used.

**OPEN (small):** the Substack digest card shows Posts + Subscribers but NOT Paid.
Paid (supporters) lives in `audience_snapshots.metadata`, which isn't in
`daily_platform_rollups` → not in the digestPlatforms memo. To show Paid on the card,
fetch latest supporters per substack account separately. Offer to Trevor.

**Code-quality fixes — DONE + DEPLOYED 2026-06-28 (commit c60cee24):**
- Silent swallow fixed (warns HTTP status/body).
- Ingestion log relabeled `content_sync` → `substack_sync`.
(The dead `subscriber_count` fetch in sync-substack can be removed entirely now — it will
never return data; low priority cleanup.)

**Cron:** `sync-substack` runs daily `0 4 * * *` (active) — keeps syncing Substack
articles via RSS; subscriber count comes from manual entry, not this fn.

### Pending — Priority KPI metrics: verify, fix, add + rescope Weekly brief (2026-06-28)

Umbrella spec. Trevor defined the metric set he actually cares about; goal is
(1) make current pulls correct/consistent, (2) add what's missing / fix what's
inconsistent, (3) rescope the Weekly KPI brief to ONLY these. Substack
subscriber piece detailed in the section above (Gmail-parse) — referenced here.

**Priority metric set:**
- **YouTube** (all channels) — everything as-is (keep all current metrics)
- **TikTok** — Views, Followers, Likes
- **Instagram** — Views, Followers, Likes
- **Substack** — Posts, Likes, Subscribers, Paid Subscribers
- **Simplecast** — Downloads

**Locked decisions (Trevor, 2026-06-28):**
- Instagram "Likes" → **relabel as "Engagement"** (Metricool exposes no pure-likes
  at account level; current value is `postsInteractions` = likes+comments+shares).
  Keep the value, rename in UI + brief. No new fetching.
- Substack "Likes" → **DROP** (no reliable public source; would need fragile
  authenticated scraping). Track Posts + Subscribers + Paid only.
- Substack Subscribers + Paid → via Gmail-parse plan (see section above).

**Verification status (live-confirmed 2026-06-28, last 7 days of DB values):**

| Want | Status | Cause |
|---|---|---|
| YouTube (all) | OK | except More Mayday content frozen Jun-24 (external API) |
| TikTok Views | BROKEN — 0 every day | mapped to `profile_views` (sync-metricool:55) |
| TikTok Followers | OK | `followers_count` |
| TikTok Likes | OK | real daily values |
| Instagram Views | OK | 20k–36k/day |
| Instagram Followers | OK | fresh |
| Instagram Likes | WRONG METRIC | `postsInteractions` mislabeled as likes (sync-metricool:37) |
| Substack Posts | OK | RSS → content_items |
| Substack Likes | NOT TRACKED | hardcoded 0 — being dropped per decision |
| Substack Subscribers | BROKEN since Mar-05 | endpoint 404-gone (see section above) |
| Substack Paid Subs | BROKEN | same dead endpoint |
| Simplecast Downloads | NOT INTEGRATED | platform doesn't exist in system |

**Metricool available metrics (from sync-metricool/index.ts:18–28 comments):**
- TikTok: `video_views, profile_views, followers_count, followers_delta_count, likes, comments, shares`
- Instagram: `...impressions, reach, profile_views, postsCount, postsInteractions, views, accounts_engaged` (no pure `likes`)
- Facebook: has `likes` (not needed — FB out of scope)

**Fix tasks:**

1. **TikTok Views — drop-in fix.** `sync-metricool/index.ts:55`: change
   `metric: "profile_views"` → `metric: "video_views"` for the tiktok `views`
   field. `video_views` is a valid TikTok metric; `profile_views` returns 0.
   (Decide cumulative flag: video_views is likely a daily/period value, not a
   running total — verify against a Metricool sample before setting `cumulative`.)

2. **Instagram Likes → Engagement relabel.** Value stays (`postsInteractions`,
   sync-metricool:37). Rename presentation only:
   - `src/pages/analytics/constants.js` / wherever the metric label lives
   - `WeeklyReport.js`, `AnalyticsMobile.js`, Analytics.js KPI labels
   - No edge-function data change needed. (Note: the brief already computes
     `engagement = likes+comments+shares`, so IG "likes" feeding it is internally
     consistent — this is purely a display-label correction.)

3. **Substack code-quality fixes** (from section above, restated):
   - Stop silent swallow (sync-substack/index.ts:62–82).
   - Relabel ingestion log `content_sync` → `substack_sync` (sync-substack:44).
   - Remove the dead `subscriber_count` fetch once Gmail-parse lands.
   - Stop writing hardcoded `likes: 0` for Substack (likes dropped from scope).

4. **Simplecast — NEW integration.** Build `sync-simplecast` edge function.
   - API: base `https://api.simplecast.com`, auth `Authorization: Bearer {token}`
     (token from Simplecast Private Apps page). Endpoints: `GET /podcasts`,
     `GET /episodes?podcast={id}`, analytics `GET /analytics?podcast={id}` and
     `GET /analytics/downloads?podcast={id}` / per-episode downloads.
   - New `platform_accounts` row: platform='simplecast', external_id=podcast_id,
     credentials hold the API token (mirror how other platforms store secrets).
   - Storage: daily total downloads → `platform_daily_metrics` (use `views` field,
     or add a `downloads` column — decide; `views` reuse keeps brief math simple).
     Episodes → `content_items` (content_type='podcast_episode'),
     per-episode downloads → `content_metrics.views`.
   - Add to `PLATFORM_META` (constants.js + AnalyticsMobile.js): `simplecast`.
   - Cron: add `sync-simplecast` daily (match others, e.g. `0 6 * * *`).
   - **BLOCKED — needs from Trevor:** Simplecast API token + which podcast(s) to track.
   - Docs: https://apidocs.simplecast.com/ , https://help.simplecast.com/hc/en-us/articles/21953603587613

5. **Weekly KPI brief rescope.** Restrict `generate-weekly-report` + renderers to
   the priority set only.
   - `generate-weekly-report/index.ts` (~lines 229–443): limit platform aggregation
     to youtube / tiktok / instagram / substack / simplecast; drop facebook, twitch,
     stripe, fourthwall, twitter, threads from per-platform breakdowns.
   - Reframe per-platform metrics to match the set: YouTube (all), TikTok
     (views/followers/likes), IG (views/followers/**engagement**), Substack
     (posts/subs/paid), Simplecast (downloads).
   - Decide revenue's place: brief currently has a full revenue section (Stripe/
     Fourthwall/YouTube). Trevor's list omits revenue — confirm whether to keep a
     revenue summary or cut it entirely. **OPEN QUESTION.**
   - Renderers: `src/pages/analytics/components/WeeklyReport.js`,
     `src/pages/AnalyticsMobile.js` — update KPI cards + per-platform sections +
     PLATFORM_META filtering. Consider a single shibboleth `BRIEF_PLATFORMS` array
     so the scope is edited in one place.

**Open inputs / questions for Trevor:**
- Simplecast API token + podcast id(s).
- Keep or cut the revenue section in the rescoped Weekly brief?
- TikTok `video_views` cumulative semantics — confirm with a live Metricool sample.

**Key files:** `supabase/functions/sync-metricool/index.ts`,
`supabase/functions/sync-substack/index.ts`, `supabase/functions/sync-simplecast/index.ts` (new),
`supabase/functions/generate-weekly-report/index.ts`,
`src/pages/analytics/constants.js`, `src/pages/analytics/components/WeeklyReport.js`,
`src/pages/AnalyticsMobile.js`.

**BUILD STATUS (2026-06-28) — in working tree, NOT committed/deployed:**
- ✅ TikTok Views — FIXED + deployed + verified live. Root cause: wrong Metricool
  subject. `account/video_views` returns empty; the real data is at `subject="video",
  metric="views"` (daily values). Confirmed live 2026-06-28: 06-22→27 = 1831, 5709,
  20535, 33992, 19373, 7864. Backfilled 14 days. (Valid `video` metrics: videos, views,
  comments, shares, interactions, likes, reach, engagement, impressionSources, averageVideoViews.)
- ✅ Substack code fixes — `sync-substack/index.ts`: log relabeled `content_sync`→`substack_sync`; silent `catch` now `console.warn`s the HTTP status/body. Dead subscriber_count call left in place (replaced later by Gmail-parse). Needs deploy.
- ✅ IG Likes→Engagement — no code change needed; renderers already label likes+comments+shares as "Engagement". Confirmed via grep.
- ✅ Weekly brief rescope — `generate-weekly-report/index.ts`: added `BRIEF_PLATFORMS` set (youtube/tiktok/instagram/substack/simplecast); scopes audience/reach/content/completeness; **revenue kept unscoped** per Trevor. Needs deploy.
- ✅ Simplecast — NEW `sync-simplecast/index.ts` (verified live against the API 2026-06-28)
  + cron migration `20260628000001_cron_sync_simplecast.sql` (daily 06:30 UTC)
  + enum migration `20260628000002_add_simplecast_platform_type.sql`.
  Registered in `PLATFORM_META` (constants.js + AnalyticsMobile.js).
  - API confirmed: auth = `Bearer <raw base64 token>`; `/analytics/downloads?podcast=…`
    returns `{ total, by_interval:[{interval, downloads_total}] }` (true per-day series,
    no delta hack). Function stores by_interval daily downloads → `platform_daily_metrics.views`
    (last 35 days), episodes → content_items, per-episode downloads for recent episodes only.
  - DONE LIVE: enum value `simplecast` added; `platform_accounts` row created
    (id a71e94f6-c96e-4301-9df9-f6362cc2c3a8, account_name 'Mayday! with Trevor May',
    external_id cd026ec3-23d1-4f4d-b3b1-30f543e0ff4f, token in credentials.api_token).
    Tracking ONLY this podcast (Trevor's choice; account has 4, others skipped).
- Decision recorded: Substack Likes DROPPED.

**REMAINING — DEPLOY (needs Trevor's explicit OK; nothing deployed yet):**
1. `supabase functions deploy sync-simplecast --no-verify-jwt`
2. Redeploy edited fns: `sync-metricool`, `sync-substack`, `generate-weekly-report`.
3. Apply migrations `20260628000001` (cron) + `20260628000002` (enum, already live).
4. Commit working-tree changes (7 files) when ready.
- Verify after first sync-metricool run: TikTok `video_views` populating + cumulative
  flag correct. Mayday podcast all-time downloads = 7753, 158 episodes, daily series
  back to 2026-04-22 (so backfill of last 35 days lands immediately on first run).

### Pending — Ops page not showing updates (2026-06-11)

Ops dashboard remains stale — no fresh ingestion/sync/edge-function activity
showing despite recent runs. Need to audit:
- Whether the data sources (ingestion_runs, ingestion_logs, edge function
  invocations) are actually being written.
- Whether the page query filters are dropping recent rows.
- Whether realtime subscriptions on the Ops page are bound to the right
  channels.

### Pending — Missing team members from Workflows Team Section (2026-06-11)

Workflows page Team Section is missing three profiles that should appear:
- **Trevor May (CEO)**
- **Emily Jude**
- **Ethan Jones**

Likely culprit is the `TEAM_ROLES` filter in `src/pages/Workflows.js`
(`teamProfiles` useEffect) — it filters by `role IN (...some allowlist...)`.
Whatever role these three profiles have isn't in the allowlist. Audit:
1. Pull profiles.role for each missing user.
2. Confirm whether `TEAM_ROLES` should add their role or whether their role
   is wrong in DB.
3. Decide whether owners/leadership should always render in Team Section
   regardless of role.

### Done — Wire Projects board progress into Workflows Team + Contractors sections (2026-06-12)

Workflows Team + Contractors sections now append project cards under each
person's row. `project_stage_assignments` joined to `projects` filtered to
`stage = projects.status AND archived_at IS NULL` → blue dot + "PROJECT" badge
under tasks-based mirror (PROJECTS sub-list). Done · 7d picks up project rows
where `projects.archived_at` falls within last 7 days. Tasks remain primary.

### Done — Contractor-assignment auto-complete hooks (Mayday Kanban port, 2026-06-12)

Migration `20260612200000_contractor_assignment_auto_complete_hooks.sql`
installs two SECURITY DEFINER trigger functions on `freelancer_assignments`:

- `auto_complete_film_on_assignment_insert` — fires AFTER INSERT. Closes open
  `film` tasks for the project when a contractor assignment is created.
- `auto_complete_edit_on_assignment_complete` — fires AFTER UPDATE OF status.
  Closes open `edit` tasks when the assignment transitions to `completed`.

Scope (all conditions must match):
- `projects.type = 'mayday_video'`
- `freelancer_assignments.assignment_type = 'edit'`
- `projects.status` matches the stage being closed (`film` / `edit`)

Each closed task fans out one `task_assigned` notification to its assignee
mirroring the `card-move` pattern. `card-move`'s mayday_video stage
descriptions + `src/lib/kanbanStages.js` updated to drop the (TODO) markers.

### Unified Content Kanban (locked spec, 2026-06-10)

Replace Projects page Kanban with a type-aware unified board for all content projects. Disable workflow-instance creation + automation triggers while developing (nav stays; in-flight runs continue).

**Project types (4)** — collapses existing 10
- `mayday_video` → More Mayday
- `tm_baseball_video` → Trevor May Baseball
- `podcast`
- `short_form`

Channel field dropped (derived from type). AWA Wiffle retired.

**Columns** — shared canonical (6), type-specific labels (Map A, verb-leaning)

| Canonical | Mayday  | TM Baseball | Podcast | Short Form |
|-----------|---------|-------------|---------|------------|
| Idea      | Idea    | Idea        | Idea    | Idea       |
| Write     | Script  | Script      | Outline | Concept    |
| Produce   | Shoot   | Shoot       | Record  | Capture    |
| Edit      | Edit    | Edit        | Edit    | Cut        |
| Review    | Review  | Review      | Review  | Review     |
| Publish   | Publish | Publish     | Publish | Publish    |

**Assignment + tasks**
- Reuse `project_stage_assignments(project_id, stage, user_id)` — N assignees per stage allowed.
- Card enters column → one task per assignee (N tasks). Title: `{project name} — {column label}`.
- No manual complete; tasks close atomically on card move.
- Notif: task-creation notif only (drop legacy column-change notif).

**Carry-forward to next task**
- Rolling notes thread (all prior columns).
- Hold reason (if recently held).
- Outgoing-assignee handoff note (optional input on exit).
- Previous-column outputs (links/files).
- Card-level due date.

**Drag rules**
- Forward: current column assignees + admins.
- Backward: admin only. Closes current tasks; creates fresh tasks for prior-column assignees.
- Type change mid-flight: relabel column in place, retitle open tasks. Card stays put.

**Hold**
- Sidecar lane on right edge, collapsible. Admin-only hold/unhold with required reason.
- Storage: `projects.on_hold bool` + `projects.hold_reason text`.
- Open tasks suspended (no nag) while held.

**Sort within column**: auto by due date ascending. Drag only changes columns.

**Publish terminal**: stay current week; Monday 00:00 PT cron archives to `projects.archived_at`; "Published" expander shows archived.

**Visibility**: admin + assistant + member. Contractors: no board; get auto-generated tasks in portal as today.

**Doc linkage**: card surfaces "Open" buttons for `write_doc_id` / `beat_sheet_id` / `ad_read_id`. No auto-create.

**New project create**: form has "Start at column" dropdown (default Idea).

**Migration**

Type collapse:
- `youtube_video` → `mayday_video` (default)
- `short_form` / `podcast` → unchanged
- `social_post`, `substack_article`, `sponsorship`, `collaboration`, `documentation`, `administration`, `other` → NULL (admin re-tag tray)

Status collapse (creative): concept→Idea, script→Write, production→Produce, edit→Edit, review→Review, published→Publish.

Status collapse (legacy shorts): editing→Edit, ready_to_post→Review, posted→Publish.

Re-tag UX: persistent yellow banner above board (`N projects need a type`) → modal w/ type picker. Banner disappears at zero.

**Unplug Workflows**
- Disable workflow-instance creation endpoints + UI buttons.
- `automations.is_enabled = false` where actions include workflow-creating step.
- Workflows sidebar nav stays.
- In-flight `workflow_instances` continue to completion.

**Key touchpoints**
- `src/pages/Projects.js` — gut Kanban; rebuild as type-aware board.
- `src/pages/Workflows.js` — disable creation paths + UI.
- `supabase/functions/run-automations/index.ts` — gate workflow-creating actions.
- New columns: `projects.on_hold`, `projects.hold_reason`, `projects.archived_at`, `projects.start_column`.
- New tables: `project_card_notes` (rolling thread per column), `project_card_handoffs` (exit notes per transition).
- New edge fns: `card-move` (server-side fan-out + carry-forward + RLS check), `archive-published-cards` (Monday cron).
- New migration: `projects.type` CHECK constraint update to 4 values after backfill.

**Phasing**
1. Schema + migration (columns, new tables, backfill, re-tag banner).
2. Unplug workflows.
3. Backend (`card-move` edge fn, server task fan-out, carry-forward).
4. Board UI rebuild (desktop).
5. Archive cron + Publish expander.
6. Cleanup dead workflow paths.

Mobile swipe view tracked in the **Mobile View** section below.

### Long-term
- **Business Dev Page** — Full spec written (in CLAUDE.md), not yet built. Four-level hierarchy: Phase > Workstream > Initiative > Task. Four views: Phases, Timeline/Gantt, Calendar, My Stuff. Tables: `bd_phases`, `bd_initiatives`, `bd_initiative_links`, `bd_tasks`, `bd_milestones`, `bd_settings`.
  - Deferred from v1: Comments/discussion threads, file attachments, budget rollup view, non-admin owners and visibility, MyBoard/personal_tasks integration, email reminders
- Consider converting remaining enums to text + check constraints (proven pattern)

---

## Mobile View

Everything mobile-specific lives here. The mobile build is a parallel set of
`*Mobile.js` page components selected at the 640px viewport breakpoint.

### Done
- **Mobile bundle split recovery** — `App.js` listens via `matchMedia` and reloads when the viewport crosses the 640px breakpoint after boot, so the desktop/mobile bundle split doesn't strand the user on the wrong build.

### Pending
- **Unified Content Kanban — mobile swipe view** — Vertical scroll one column at a time, swipe between columns, long-press menu replaces drag. Last phase of the Unified Kanban rollout (desktop board shipped; mobile view not yet built). Touchpoint: `src/pages/ProjectsMobile.js`.

### Mobile-paired pages
- `AuthPage.js` ↔ `AuthPageMobile.js`
- `AppLayout.js` ↔ `AppLayoutMobile.js`
- `Projects.js` ↔ `ProjectsMobile.js`

When adding a feature to a desktop page that has a mobile counterpart, mirror the change (or explicitly note that mobile is deferred).

---

## Infrastructure & Architecture Improvements

Based on inefficiency report review (June 2026). Items are grouped by phase; each was either agreed-upon from the report or identified as an additional recommendation during review.

### Phase 0 — Immediate Correctness & Security

| Item | Source | Status | Notes |
|---|---|---|---|
| Fix More Mayday YouTube sync | Report #20 | **In progress** | Code is correct — YouTube API returns the same 167 video IDs. Added freshness detection: API error checking in `fetchAllVideoIds`, staleness warnings when no new videos found, `newest_content_at`/`total_api_videos`/`existing_db_videos` metadata on ingestion logs. Root cause is external (stale API response or quota). Deploy updated `sync-youtube` and monitor. |
| Rotate hardcoded `CRON_SECRET` | Report #18 | **Done** | Rotated in migration `20260512130000`, moved to Supabase Vault in `20260601140000`, sync jobs switched to header-based auth in `20260601150000`. |
| Deploy staged Goals fixes | Report #22 | **Done** | All three fixes live in `YearlyGoalsSection.js`: `reel` filter (line 288), auth header on metricool-posts (line 262), channel names in Monthly Results (lines 876-882). |
| Fix "Total Short Form Posts" goal configuration | Report #21 | **Done** | Updated `monthly_goals` to include YouTube (Trevor May Baseball + More Mayday), Instagram, and TikTok platform account IDs. |

### Phase 1 — Stabilize Platform Infrastructure

| Item | Source | Notes |
|---|---|---|
| Split AuthContext into smaller providers | Report #3 | 692-line context owns auth, session, profile, presence, realtime, notifications. Split into AuthSessionProvider, ProfileProvider, PresenceProvider, NotificationProvider, RealtimeProvider with focused hooks (`useSession`, `useProfile`, `usePermissions`, `usePresence`, `useNotifications`). |
| Replace session nuking with staged degradation | Report #5 | Profile fetch failure after 3 retries currently nukes the session. Replace with: 0-4s loading → 4-10s reconnecting/degraded → 10s+ "profile unavailable" with retry + sign out option. Only nuke on definitively invalid/revoked token. |
| Server-side notification summary RPC | Report #6 | Move badge count logic out of AuthContext. Create a `getNotificationSummary(userId)` RPC that returns all counts in one call. Realtime updates invalidate cached summary instead of each badge source maintaining its own fetch/subscription. |
| Edge Function standardization (`createFunction` wrapper) | Report #16 | Create a shared wrapper with explicit auth modes (`public`, `user`, `admin`, `cron`, `cron-or-admin`, `webhook-signed`), input validation, structured logging, request IDs, error formatting, timeout/retry policy, and rate limiting. |
| Build ingestion control plane | Report #19 | Tables: `source_accounts` (platform, status, token_status, last_success_at, last_data_seen_at), `ingestion_runs` (records_fetched/inserted/updated/skipped, newest_source_item_at, error), `ingestion_alerts`. Dashboards show freshness per source. |
| Build Ops dashboard | Report #46 | Internal admin page showing: sync health, external API quota/token health, latest ingestion runs, edge function errors, cron run status, automation failures, public endpoint abuse/rate limits, realtime connection health, known issue status. |
| Add rate limiting to authenticated edge functions | Additional | Currently only public endpoints have rate limiting. Authenticated functions (especially admin-triggered syncs, bulk operations) should have basic rate limiting to prevent accidental abuse. |
| Fix `reconnectRealtime()` hardcoded 150ms delay | Additional | Uses a fixed 150ms `setTimeout` before reconnecting. Should use exponential backoff with jitter to avoid thundering herd on infrastructure issues. |

### Phase 2 — Reduce Frontend Maintenance Cost (Completed 2026-06-08)

| Item | Source | Status | Notes |
|---|---|---|---|
| Add error boundaries on pages | Additional | **Done** | Created `PageErrorBoundary` component, wrapped all ~46 page entries in `AppLayout.js`. |
| Enable strict CI | Additional | **Done** | Flipped `CI=false` → `CI=true` in build script. Added `ignoreWarnings` for node_modules Critical dependency warnings in `craco.config.js`. |
| Standardize realtime subscriptions (`useRealtimeTable`) | Report #11 | **Done** | Created `src/hooks/useRealtimeTable.js` with per-event handlers, exponential backoff retry, and ref-based stale closure prevention. Pilot-migrated `FreelancerDashboard.js` (4 table subscriptions). Remaining pages can migrate incrementally. |
| Split Analytics.js into feature modules | Report #13 | **Done** | Decomposed 3,290-line monolith into `src/pages/analytics/` directory: `Analytics.js` (orchestrator), `constants.js`, `utils.js`, `styles.js`, and 13 components in `components/`. Remaining large pages (Reviews, BusinessDev, Dashboard) can follow the same pattern. |

### Phase 3 — Operational Maturity

| Item | Source | Notes |
|---|---|---|
| Make deployments atomic | Report #44 | Frontend auto-deploys to Vercel on push, but edge functions and migrations are manual. A frontend change can deploy before its migration. Create a release checklist or lightweight pipeline: migrations → edge functions → frontend, with smoke tests at each stage. |
| Document and harden Triton client dependency | Additional | Second Supabase project (Triton, read-only for briefs/cards) is initialized inline with hardcoded URL/key. If Triton goes down, affected pages fail silently. Document which features depend on it, add connection health checks, and consider a fallback/cache strategy. |
| Address Google Drive service account single point of failure | Additional | All Drive functions use one shared service account via `GOOGLE_DRIVE_REFRESH_TOKEN`. If token is revoked or account is disabled, all Drive features break simultaneously. Document the account, set up token health monitoring, and consider a backup credential. |
| Reduce `drive-watch-poll` frequency | Additional | Runs every minute (1440 API calls/day). Most Drive changes don't need minute-level detection. Evaluate whether 5-minute or 15-minute intervals are sufficient, or switch to push notifications via Drive webhooks where possible. |
| Add backup/export strategy for Supabase data | Additional | No documented backup or export strategy. Supabase provides point-in-time recovery on Pro plans, but there's no manual export process for critical tables (financials, projects, content). Set up periodic pg_dump or Supabase backup verification. |

## Full-Codebase Bug Audit (2026-06-20)

Two-wave parallel audit across ~90% of pages + nearly all edge functions. The
HIGH-severity automation/sync/security cluster was fixed, migrated, and deployed
the same day. Everything below marked **Open** is unaddressed.

### Fixed + deployed (2026-06-20)

Edge functions redeployed (`run-automations`, `workflow-trigger-event`,
`sync-stripe`, `sync-metricool`, `backfill-youtube-dimensions`); migration
`20260620120000_automations_time_utc_to_hour_pt.sql` applied.

| Item | Fix |
|---|---|
| `run-automations` DST + dead minute picker | `hour_pt` + live `America/Los_Angeles` offset; UI now hour-only PT dropdown |
| `run-automations` dedup missing-var collapse | `resolveTemplateStrict` → skip fire when a `{{var}}` is absent |
| `run-automations` partial-insert re-run duplicates | per-(automation, dedup_key, assignee) idempotency check |
| `workflow-trigger-event:51` `...:event:undefined` dedup collision | fall back to full-payload key when id missing |
| `sync-stripe:252/276` 100-row cap drops revenue/subs | paginate via `has_more`/`starting_after` + `res.ok`/`error` checks |
| `sync-metricool:394` follower backfill off-by-one | include anchor day, step running total past its own gain |
| `backfill-youtube-dimensions:225` no auth (destructive, `--no-verify-jwt`) | CRON_SECRET-or-admin gate (verified live 401) |
| `AppLayout` `mailer`/`broadcast` mounted for non-admins | `isAdmin` gate (broadcast → `canAccessBroadcast`); **frontend, needs Vercel deploy** |

### Fixed — pending deploy (2026-06-20, second batch)

The 5 🔴 security/data-loss items. Code committed; **edge functions not yet
redeployed, frontend not yet pushed to Vercel.** Migration
`20260620130000_script_review_versions_unique.sql` applied.

| Loc | Fix |
|---|---|
| `post-daily-graphics/index.ts:35` | Admin role gate on the authed-user path (cron path unchanged) |
| `generate-brief-onepager/index.ts:38` | `isSafeExternalUrl(file_url)` SSRF guard before fetch |
| `google-drive-folders/index.ts:77,124` | `/^[\w\-]+$/` sanitize + `isDescendantOfRoot` check on GET + POST `parentId` |
| `src/pages/editors/Storyboard.js:106` | `pagesRef`/`currentPageRef`/`annotationsRef`; `saveCurrentPage` reads refs |
| `src/pages/Ideation.js:374` | unique `(review_id, version_number)` constraint + client retry on 23505 |

**Deploy still needed:** `supabase functions deploy post-daily-graphics generate-brief-onepager google-drive-folders --no-verify-jwt` + Vercel push for Storyboard/Ideation.

### Fixed — pending deploy (2026-06-20, third batch — remaining HIGH)

Frontend only; ships on the next Vercel push (no edge/DB changes).

| Loc | Fix |
|---|---|
| `src/pages/FreelancerProfile.js:60` | Capture `Promise.all` results, throw on first `{error}` → failed save shows the error |
| `src/pages/Freelancers.js:319` | `creatingAssign` flag + disabled button → no double-submit |
| `src/pages/Jobs.js:117` | Swap the two listings' actual `position` values (null-safe) instead of reindexing the filtered subset |
| `src/pages/Calendar.js:124` | Series-termination checks (endDate/endCount) moved before the range cull; separate `iterations` loop guard; `[...days].sort()` no longer mutates the event |
| `src/pages/CalendarMobile.js:26` | `dayKey` built from local Y-M-D parts |
| `src/pages/editors/screenplay-editor/.../ScriptEditor.tsx:585` | Named `visibilitychange` handler removed in cleanup |

### Open — HIGH / security

_None — all HIGH findings fixed (deploy/push pending)._

### Fixed — pending deploy/push (2026-06-20, MED batch — all 25)

5 edge functions need deploy: `fetch-daily-graphics`, `google-drive-write`,
`google-calendar-sync`, `drive-upload-init`, plus `run-report` + `preview-report`
(they bundle the edited `shared/report-sources.ts`). Rest is frontend (Vercel push).

| Loc | Fix |
|---|---|
| `InvoicingMobile.js:275,276` | Re-derive `tax_cents` from edited subtotal; mark-paid records full `total_cents` |
| `Production.js:1269` | Media thumbs keyed by content; reorderable tag spans keyed by value |
| `Reviews.js:892` | `createTimer` ref cleared in loadPlayer + unmount |
| `KanbanPanel.js:879` | Terminal columns re-bumped above reindexed range; refetch on save failure |
| `drive-upload-init:100` | Non-admins confined to submissions/assigned folder (+descendants) via `isDescendantOf` |
| `AppLayout.js:286,347` | Route guard redirects adminOnly pages for non-admins; freelancer redirect deps include `activeTab` |
| `AuthContext.js:246` | `isPasswordRecoveryRef` read in the listener |
| `google-calendar-sync:154` | Admin gate (matches google-calendar-fetch) |
| `fetch-daily-graphics:26` | Admin role check |
| `google-drive-write:96` | `/^[\w\-]+$/` folderId sanitize |
| `shared/report-sources.ts:70` | `isSafeExternalUrl(endpoint)` SSRF guard |
| `BusinessDev.js:749,763` | completed_at only stamped on transition to done; position recomputed on phase/workstream move |
| `CalendarMobile.js:507` | Shared `src/lib/recurrence.js` expansion + fetch includes recurring rows (desktop kept its copy) |
| `Channels.js:134,199` | DELETE handler (unfiltered, id-match); swap actual `sort_order` values |
| `ContentHealthDashboard.js:93` | `fetchGenRef` stale-response guard |
| `Tracking.js:299` | Null-id target guarded; edit recovers real id instead of `.eq('id',null)` |
| `Telestration.js:62` | Revoke object URLs from refs |
| `Organize.js:24` | Centralized object-URL revoke via prev-files ref + unmount |
| `YouTubeStudioAdvanced.js:1117` | `[...rows].sort()`; key by `_key` |
| `FreelancerDashboard.js:263` | `postingComment` in-flight guard |
| `Jobs.js:649,662` | Optimistic rollback on save failure; rename compares full list |
| `Storyboard.js:113,308` | Baseline history pushed in load callback; thumbnail skipped while load in flight |

### Open — MED

_None — all MED findings fixed (deploy/push pending)._

### Fixed — LOW batch (2026-06-20)

All LOW findings below were fixed **except** the two Deferred items noted here.
11 edge functions changed (need deploy: sync-metricool, mailer-webhook,
mailer-send-now, approve-automation, sync-fourthwall, drive-watch-register,
metricool-stories, google-calendar-sync, twitch-auth-callback, stats-query,
jobs-view); rest is frontend (Vercel push). Migration `20260620140000_jobs_view_dedup`
applied.

- **Research IP (1297/1346): verified correct, no change** — Triton stores
  true-decimal innings (7.333, 5.667), so the `×3` outs conversion is right.
- **Deferred — `Ideation.js:1182`** — `setTimeout(setActiveDoc,100)` works; a
  clean fix needs a pending-doc state machine. Low value.
- **Deferred — `Research.js:386`** — bucket-switch stale-response guard; manual
  toggle, negligible race.

| Loc | Problem (fixed unless noted above) |
|---|---|
| `sync-metricool/index.ts:130`, `src/pages/Accounting.js:312` | No `Number.isFinite`/`||0` guard → one bad row poisons metrics with NaN |
| `src/pages/Payroll.js:283` | `handleTogglePaid` no disable/await → double-tap duplicate `payroll_paid` rows |
| `supabase/functions/mailer-webhook/index.ts:47` | Svix sig non-constant-time `===`, no timestamp freshness → replayable |
| `supabase/functions/mailer-send-now/index.ts:256` | `fetchLatestRssItem` skips `isSafeExternalUrl()` SSRF guard |
| `supabase/functions/approve-automation/index.ts:184` | Any admin resolves another admin's specifically-assigned confirmation |
| `supabase/functions/jobs-view/index.ts:49` | Public unauthed unrate-limited insert → analytics bloat |
| `supabase/functions/stats-query/index.ts:99` | Any authed user; returns raw SQL+result (bounded by Triton read-only) |
| `src/pages/Production.js:278` | Autosave fires on `openSheet()` → redundant write of just-loaded data |
| `src/pages/Reviews.js:839` | `<ReviewPlayer>` missing `key={review.id}` → stale `activeVersion` across switch |
| `src/components/SprintBoard.js:1094` | Sprint done → `workflow-complete-task` uses pre-drag linked-task snapshot |
| `src/pages/Research.js:1297,1346` | IP-notation conversion `*3` may mis-show every fractional IP — verify Triton storage convention |
| `src/pages/Research.js:524,386` | `localeCompare` on null `date` throws; bucket-switch has no stale-response guard |
| `src/pages/Channels.js:505` | Message groups keyed by array index while streaming via realtime |
| `src/pages/Ideation.js:169,442,1168` | Drag-reorder no rollback; `setTimeout(setActiveDoc,100)` fragile race / unmount setState |
| `src/pages/FreelancerHours.js:15` | `toISOString` period boundary off-by-one for UTC+ users |
| `src/pages/Jobs.js:757` | Funnel "Interview" double-counts accepted |
| `src/pages/Freelancers.js:458` | `handleReviewHours` no double-click guard → re-stamp + dup notification |
| `src/pages/FreelancerDashboard.js:196` | `useRealtimeTable('fl-comments')` unfiltered → needless refetch churn |
| `src/pages/analytics/Analytics.js:242` | Net/Total Followers ignore platform filter |
| `src/pages/analytics/Analytics.js:231` | Single-day range → prev query empty → always +100%/0% |
| `src/pages/YouTubeStudioAdvanced.js:815,241` | Reorder-dependent row key; `slice(0,7)`/`localeCompare` no null-date guard |
| `supabase/functions/sync-fourthwall/index.ts:129` | `while(true)` never terminates if `totalPages` undefined (NaN) |
| `supabase/functions/drive-watch-register/index.ts:119` | Leaks upstream API error text in `detail` |
| `supabase/functions/metricool-stories/index.ts:53` | `days` param unbounded |
| `supabase/functions/twitch-auth-callback/index.ts:81` | State user_id not re-checked for admin before overwriting creds |
| `supabase/functions/google-calendar-sync/index.ts:34` | Post-refresh `access_token` used without null check |
| `src/components/Morty.js:473+` | Untracked `setTimeout`s not cleared by `clearAllTimers` → setState-after-unmount |
| `src/pages/DashboardMobile.js:248` | `commitEdit` optimistic update with no rollback on failure |
| `src/pages/editors/Storyboard.js:266` | Async page ops no unmount guard |
| `src/pages/editors/screenplay-editor/.../ScriptEditor.tsx:919,50` | Save via synthetic `blur` event fragile; load plugin no abort guard |
| `src/pages/editors/doc-editor/editor/search-highlight.ts:36` | Rebuilds full DecorationSet every transaction (per-keystroke cost) |
| `src/pages/BusinessDev.js:1002` | `handleToggleTask` ignores update error → silent revert |
| `src/pages/Calendar.js:257,155` | Global mousedown dismisses own context menu; `.sort()` mutates live event object |
| `src/pages/Dashboard.js:806` | Presence "offline" flip not re-rendered on a timer |

### Wave 3 — previously-unswept files (2026-06-20)

8 parallel auditors swept all public pages, standalone desktop pages, ~18 mobile
variants, shared components, and editor/analytics sub-components. Fixed:

**CRITICAL / security**
- `AppLayoutMobile.js` — `workflows`/`freelancers`/`ops` had NO `isAdmin` gate
  (reachable by non-admins via direct URL / persisted tab); `invoicing` allowed
  assistants (desktop is admin-only). All gated; invoicing tightened to `isAdmin`.
- `PublicBrief.js` / `Deliverables.js` / `WriteAdReadModal.js` — stored XSS:
  `marked.parse()` of LLM-generated (attacker-influenceable) markdown rendered raw.
  Now `DOMPurify.sanitize(marked.parse(...))`.
- `PublicCareers.js` — `select('*')` exposed internal `job_listings` columns
  (onboarding_checklist, created_by) to anonymous visitors. Restricted to rendered columns.
- `LinkInsertDialog.tsx` — raw-HTML interpolation of user href/text → markup injection.
  Now structured insertContent with a link mark.

**HIGH (data loss / functional)**
- `SceneNavigator.tsx` — drag-reorder rebuilt from a debounced snapshot + `root.clear()`,
  dropping nodes added mid-debounce. Now groups live children → no loss.
- `CharacterManager.tsx` — rename used no word boundaries ("AL" rewrote "ALICE"). Added `\b`.
- Mobile try/finally leaks (stuck-disabled buttons on error): `FreelancerDashboardMobile.setStatus`,
  `FreelancersMobile.postComment`/`approve`.
- `MessagesMobile`/`Messages`/`ChannelsMobile` — send had no in-flight guard / lost message on
  failure / no realtime id-dedup. All fixed (+ `.maybeSingle()` for empty-convo last-message).
- `Resources.js` — double-Enter created duplicate folders/Docs (Enter bypassed disabled button).
- `AnalyticsMobile.js` — UTC date window diverged from desktop PT; now `daysAgoStr(30)`.

**MED** — `google-drive-research` orphan-doc cleanup on token-merge failure; `Ideas`/`IdeationMobile`
ordering + sort_order; `IdeasMobile` add double-submit; `FreelancerDashboardMobile` channel
namespacing; `IngestionHealthPanel`/`ManualMetricsForm` divide-by-zero guards; `ImageInsertDialog`
extension derivation; `SprintGoals` sort mutation; `SprintRetroModal`/`ProgressKanban`/
`ContractorAssignmentModal`/`SprintBacklog` rollback/guards; `FreelancerTour` measure retry;
`DocumentEditor` focus-timeout cleanup; analytics CSV escaped-quote; `OpsMobile` unmount guard;
`SprintBoardMobile` explicit status.

**Verified NOT bugs:** Ops realtime — `ingestion_logs`+`platform_accounts` ARE in
`supabase_realtime` publication (auditor hypothesis wrong; 60s poll is the fallback).
PublicCareers resume upload — `jobs-apply` enforces size/MIME/rate-limit server-side (wave-1 verified).

**Deferred LOW polish:** ChannelsMobile mention matching, IdeasMobile menu outside-click,
Assets sort-during-search, Resources rename double-request, ResourcesMobile double-fetch,
Messages fetch/subscribe sub-second gap (dedup mitigates), a few dead deps / harmless dangling timers.

### Wave 3.5 — editor deep-internals (2026-06-20)

4 auditors swept Tiptap doc-editor (core/store/hooks/menus/extensions) and Lexical
screenplay-editor (plugins/nodes/export/paginator). Fixed:

**CRITICAL — cross-document data loss**
- `DocEditor.tsx` / `useAutoSave.ts` / `Ideation.js` — editor wasn't keyed per
  document and `loaded` never reset on docId change, so editing right after a doc
  switch (or a slow/failed load) autosaved the PREVIOUS doc's content into the new
  docId, clobbering it. Fixed: `key={activeDoc.id}` remount + load-effect reset +
  cancellation + `setContent(html, false)`.

**HIGH**
- `useAutoSave` — Supabase update resolves `{error}` (doesn't throw); a failed save
  reported "saved" and silently dropped the edit. Now checks error + re-marks dirty.
- `extensions.ts` — Link had no protocol allowlist → `javascript:`/`data:` hrefs
  stored as XSS. Added `protocols: ['http','https','mailto']` + rel.
- `EditorContextMenu` / `LinkBubble` — validate URL scheme before setLink/setImage.
- `FindReplace` — replacement inserted via `insertContent(string)` (parsed as HTML →
  injection); now inserts a plain text node.
- `NotesPlugin` — highlight-to-note dropped style/detail/mode; now copies all.
- `exportPDF` — bold/italic silently dropped on multi-line elements; now maps runs
  onto each wrapped line (same line breaks → no pagination change).

**MED**
- `paginator` — element taller than a page corrupted `remaining` for all later
  elements (cascading wrong page count); `bottomHalf` could go negative. Clamped both.
- `exportFDX` — scene Number attribute now XML-escaped.
- `CommentPanel` — subscribe to editor transactions so the list/counts don't go stale.

**Deferred LOW/MED (low value or regression risk):** CommentPanel multi-node mark
delete/scroll; NoteMarkNode importDOM/exportDOM (paste roundtrip; JSON reload fine);
PageBreakPlugin raw-DOM injection (self-heals); useAutoSave last-write-wins +
beforeunload beacon (multi-tab rare); FindReplace non-ASCII whole-word; AutocompletePlugin
rect churn; CommandPalette cross-category scroll; paginator widow blank-line. All noted.

**Verified clean:** all Lexical node serialization (getType/clone/importJSON/exportJSON
round-trip), plugin disposers, FDX text escaping, editorStore, useRelativeTime.

### Audit coverage gaps (remaining)
Only `broadcast/*` (covered by the separate 2026-06-12 hardening pass) not re-swept.
**The entire app — pages, mobile variants, components, edge functions, and editor
internals — is now comprehensively audited.**

## Known Issues

### Open GitHub Issues
- **#4** — Resources / Google Docs integration
- ~~**#5** — `project_type` enum missing business board values~~ (resolved: Business board removed entirely 2026-06-12)

### Low Priority (from backend audit)
- `backfill-youtube-dimensions/index.ts:3` — inconsistent import path (`./shared/` vs `../shared/`)
- `sync-stripe/index.ts:240-254` — unnecessary braces around upsert
- `sync-metricool/index.ts:210-224` — inconsistent error logging
- `public-subscribe/index.ts:110` — hardcoded Postgres error code `"23505"` as string

### Tech Debt
- `node_modules/` drift in git status (local package versions diverge) — do not commit
- `20260328200001_cron_generate_trends.sql` contains a hardcoded `CRON_SECRET` (mitigated: secret rotated and moved to Vault, but old value remains in git history)
- Orphan remote migration `20260526035022` was reverted from history (tables already created by it exist)
- Pages are large single-file components (100-200KB) — Analytics.js split complete; Reviews.js, BusinessDev.js, Dashboard.js remain

## Architecture Notes

### Critical Patterns (from MEMORY.md)
- **useEffect deps**: always `useCallback` for async functions in dep arrays (infinite render loop otherwise)
- **Auth lock deadlock**: `onAuthStateChange` must be synchronous; defer DB calls via `setTimeout(0)`
- **Enum migrations**: convert to `text` + check constraint (can't `ALTER TYPE` in transaction)
- **Routing**: pages unmount/remount on every nav — initial `useEffect` handles data load
- **Styling**: all inline `style={{}}`, no Tailwind classes

### Key Files
- `src/pages/AppLayout.js` — routing, sidebar, page mounting, SubmitModal (Google Drive upload)
- `src/contexts/AuthContext.js` — auth, profile, notifications
- `src/hooks/useVisibilityRefresh.js` — tab restore refresh
- `src/hooks/useSupabaseQuery.js` — safe query wrapper with auth retry
- `src/pages/FreelancerDashboard.js` — contractor-facing dashboard with assignments, Submit modal, I'm Stuck flow
- `src/pages/Freelancers.js` — admin-facing contractor management
- `supabase/functions/shared/utils.ts` — shared ingestion log, upsert, retry helpers
- `supabase/functions/drive-upload-init/index.ts` — Google Drive resumable upload init (used by AppLayout + FreelancerDashboard)

## Open Risks

- Supabase CLI outdated (v2.95.4 vs v2.101.0 available) — potential compatibility issues
- Pages are large single-file components (100-200KB) — maintainability risk as complexity grows
- `CRON_SECRET` hardcoded in a migration file
