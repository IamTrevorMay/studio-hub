# Mayday Studio

Content production & operations hub for creator teams. Manages projects through concept-to-published pipeline, sprint planning, analytics, scheduling, and collaboration.

## Stack

- **Frontend**: React 18 (CRA + Craco), deployed on Vercel
- **Backend**: Supabase (Postgres, Auth, Edge Functions, Realtime)
- **Build**: `npm start` (dev), `npm run build` (prod)
- **Edge Functions**: Deno-based, deployed via `supabase functions deploy <name> --no-verify-jwt`

## Key Conventions

### Styling
- **All styling is inline `style={}` objects** — no Tailwind classes in JSX
- Color constants defined as module-level objects (`STATUS_COLORS`, `EVENT_TYPE_COLORS`, etc.)
- Styles object at bottom of each page file: `const styles = { ... }`
- Dark theme: `#0f0f1a` base, `rgba(255,255,255,...)` text, accent `#6366f1` (indigo)
- Font: DM Sans (loaded globally)

### Auth & Roles (restructured 2026-07-29; client added 2026-07-30)
- **Five top-level roles:** `admin`, `director`, `member`, `contractor`, `client`
- **`client`** = external customer with a locked portal (see Client Portal section). NOT admin-tier, NOT in `STAFF_ROLES`, genuinely RLS-fenced (`is_client()` DB helper; `is_staff()` = admin/director/member). Check via `useAuth().isClient`.
- **Sub-roles** (`profiles.sub_role`): Director → `communications` | `production` | `content_strategy` (creative renamed to production 2026-09-10 — Production holds the client-management powers); Contractor → `Editor`, `Graphic Designer`, `Developer`, `Writer`, `Producer`, `Production/Camera` (**2026-09-18: Long Form / Short Form / Podcast Editor condensed into one `Editor`**; the format now lives in `profiles.specialties text[]` — `long_form`, `social_video`, `audio_podcast`, `graphic_design`, `sound_design`, `color_correction`, multi-select, admin-set, `CONTRACTOR_SPECIALTIES` in rolePermissions + DB check constraint; shared `SpecialtyPicker` component; `EDITOR_SUB_ROLES` = Editor + legacy titles; `margin_products.match_specialty` keeps the long-form vs social routing; migration `20260918140000_editor_role_specialties.sql`). Admin/member have none. Sub-roles are display/organizational only for now — no feature gating yet (that's the next phase).
- **Removed roles:** `assistant` (folded into Director — admin-tier), `producer` (staff role deleted; unrelated to the Harbor/Broadcast session "producer" and the Projects assignment "producer", which remain), `partner` (BizDev roadmap portal + its one external user removed).
- **Admin-tier** = `admin` + `director` (DB `is_admin()`; client `isAdminTier` in `src/lib/rolePermissions.js`). Directors are UI-restricted from payroll/business_dev/workflows/accounting/admin via `ROLE_RESTRICTED_NAV_KEYS` (restriction is UI-only; RLS still passes `is_admin()`).
- Check via `useAuth()` hook: `isAdmin`, `isStrictAdmin`, `isDirector`, `isContractor`, `subRole`, `canPost`. (`isAssistant`/`isPartner`/`isProducer` are retained as always-`false` to neutralize legacy branches — prune over time.)
- Admin-only features gated with `{isAdmin && (...)}`
- **Directors have full Contractor Mode parity (2026-08-11).** A batch of pre-restructure policies and edge functions still tested `role = 'admin'` literally while the pages gated on the admin-tier `isAdmin`, so directors could open Contractor Mode but not actually use it. Now on `is_admin()` / admin-tier: `contractor_documents`, the `freelancer-documents` storage policies (upload / read / delete), `invitations` (select / insert / delete), `profiles` update+delete, and the `invite-user`, `remove-user`, `cloud-folders`, `drive-list-contractor-folders`, `impersonate-contractor` functions. Migration `20260811160000_director_contractor_parity.sql`.
- **The one thing directors still can't do is touch admin-tier accounts**, since that's the self-promotion path. New `is_strict_admin()` helper backs it: the `profiles` policies use `USING`/`WITH CHECK` to keep directors out of admin/director rows and stop them writing an admin-tier role onto anyone; `invite-user` refuses elevated invites; `remove-user` refuses to delete an admin-tier target. These guards must live in the DB / edge functions — `ROLE_RESTRICTED_NAV_KEYS` hiding AdminPanel is UI-only.
- Central role config lives in `src/lib/rolePermissions.js` (DIRECTOR_ROLES, ADMIN_TIER_ROLES, BROADCAST_TIER_ROLES, STAFF_ROLES, DIRECTOR_SUB_ROLES). Legacy `director_creative`/`director_comms` values are kept in accept-lists until the CONTRACT migration flips them to `director`; safe to prune afterward.
- Migrations: `20260729140000_role_hierarchy_expand.sql` (+ `_invites`) / `20260729150000_role_hierarchy_contract.sql`.
- Custom session management with token refresh race condition handling

### State Management
- Component-level `useState` for most UI state
- Supabase Realtime subscriptions for live updates (presence, notifications, channels)
- `useSupabaseQuery` hook for safe queries
- `useVisibilityRefresh` hook for tab re-focus data refresh

### File Structure
```
src/
  contexts/AuthContext.js    # Auth provider, profile, notifications
  hooks/                     # useSupabaseQuery, useVisibilityRefresh, useNavConfig
  components/                # SprintBoard, SprintPanel, Morty (mascot)
  pages/                     # Dashboard, Projects, Analytics, Calendar, etc.
  pages/editors/             # doc-editor (Tiptap), screenplay-editor, Whiteboard
  pages/tools/               # Teleprompter, PostShow, Organize
supabase/
  functions/                 # 30+ edge functions (sync-*, metricool-*, google-*, etc.)
  migrations/                # 90+ migrations
```

### Edge Functions
- Metricool integration: `sync-metricool`, `metricool-posts`, `metricool-stories`, `metricool-create-post`
- Platform sync: `sync-youtube`, `sync-meta`, `sync-tiktok`, `sync-twitch`, `sync-fourthwall`, `sync-stripe`, `sync-substack`
- Google Calendar: `google-auth-url`, `google-auth-callback`, `google-calendar-sync`, `google-calendar-fetch`
- Research: `fetch-rss`, `generate-trends` (daily Claude-powered trend analysis, runs via pg_cron at 8am PT)
- Assistant: `assistant-summary` — read-only admin snapshot (projects, sprint, deadlines, events) for the Mayday Assistant at assist.mmcreate.io. Strict-admin JWT required; CORS restricted to assist origins (function-local headers, not the shared `corsHeaders`); deployed `--no-verify-jwt`
- All use env vars: `METRICOOL_TOKEN`, `METRICOOL_USER_ID`, `METRICOOL_BLOG_ID`, `ANTHROPIC_API_KEY`, `CRON_SECRET`, Supabase service role key

### Database
- Two Supabase projects: main (read-write) + Triton (read-only for briefs/cards)
- Key tables: `projects`, `profiles`, `platform_accounts`, `platform_daily_metrics`, `audience_snapshots`, `admin_goals`, `personal_tasks`, `sprints`, `sprint_goals`, `research_feeds`, `research_articles`, `research_trends`, `research_inbox_state`
- RLS policies enforce role-based access

### Research System
- RSS feeds (news + newsletters) stored in `research_feeds` with `source_type` column
- Articles fetched via `fetch-rss`, stored in `research_articles`
- Daily trends generated by `generate-trends` (Claude analyzes last 48h of articles, outputs current events, evergreen topics, and graded suggestions)
- Cron: pg_cron job `daily-generate-trends` fires at 15:00 UTC (8am PT)
- Newsletters are RSS-based only — no Mailgun integration (edge functions `receive-newsletter` and `ingest-newsletter` exist but are unused)

## Commit Style
- Descriptive action-first messages: "Add feature", "Fix bug", "Redesign component"
- No strict conventional commits but semantic clarity
- Feature branches use `claude/*` prefix when automated
- **NEVER commit or push automatically** — always wait for the user to explicitly request it

### Dashboard Widgets
- "Do this more" widget (admin-only): tracks daily IG story posting goals via `metricool-stories` edge function + `admin_goals` table. Refreshes every 30s. Shows 7-day progress bars with green checkmarks when goal is met.

## Known Issues
- **sync-youtube stale for More Mayday channel.** YouTube API returns the same 167 video IDs every run — root cause is external (stale API response or quota), not a code bug. Freshness detection added: API error checking, staleness warnings in logs, and `newest_content_at` metadata on ingestion logs. Deploy updated `sync-youtube` and monitor. May need YouTube API key/quota investigation or uploads playlist ID verification.

## Important Notes
- Pages are large single-file components (100-200KB) — read specific line ranges, not whole files
- `node_modules/` changes in git status are normal (local package drift) — do not commit them
- `.env` contains Supabase keys — never commit secrets
- Migration `20260328200001_cron_generate_trends.sql` contains a hardcoded `CRON_SECRET` — secret has been rotated and moved to Vault, but old value remains in git history

## Business Dev page (admin-only, nested under Core Team folder)

Permanent multi-phase program tracker. The first phase is "Mayday Media + Neptune Performance — buildout & ops" but new phases can be added at any time (each is a self-contained program with its own launch date, milestones, initiatives, and tasks). Mayday Media is the existing content/creator side; Neptune Performance is a new baseball development lab being built out. Page lives in sidebar under the Core Team folder (alongside Analytics).

### Structure
- **Hierarchy:** Phase → Workstream → Initiative → Task (four levels; phases group everything else)
- **Phases:** `bd_phases` table. Each has name, launch_target_date, position, archived_at. Initiatives + milestones reference phase via `phase_id` (cascade delete).
- **Workstreams (7, fixed for v1):** Facility, Product, Marketing & Brand, Sales / BD, Operations, Finance, Tech / Systems
- **Tagging:** every initiative and task tagged Mayday / Neptune / Shared. Tasks can override their parent initiative's tag.
- **Owners:** admins only for now (revisit later — non-admin owners + visibility deferred)
- **Separate worlds:** does not share data with Goals page's `initiatives` table; new `bd_*` tables only.

### Initiative metadata
- Title, description, links (multiple, label + URL)
- Status: `ideas` / `planned` / `active` / `waiting` / `done` (async-friendly set)
- Owner (single admin), target date, budget (cents), priority (high/med/low), tag, workstream, position (manual order)

### Task metadata
- Title, notes, due date, owner, tag (override or inherit), position, completed_at
- Status is just a checkbox (done / not done)
- **Recurrence:** simple — `recurrence_interval` (daily/weekly/monthly) + `recurrence_count`. On check, server creates next instance with `due_date += interval`; old completed instance stays.

### Views (4 tabs)
1. **Phases** (default) — vertical list of collapsible phase cards. Each card has its own header (countdown, milestones, overall %), its own filter bar (tag pills + Hide Done), and a workstream-grouped tree of initiatives. Solo phase auto-expands; multi-phase setups default collapsed.
2. **Timeline / Gantt** — horizontal bars per initiative across a time axis, grouped by phase then workstream, color-coded by tag. Phase chip filter at top.
3. **Calendar** — month grid with task due dates, initiative target dates, milestones as pills. Pills colored by phase. Phase chip filter at top.
4. **My Stuff** — current admin's owned tasks + initiatives only. Phase chip filter at top. BD-scoped (no SprintBoard merge for v1).

### Per-phase header (inside each phase card)
- **Launch countdown** — driven by phase's own `launch_target_date`
- **Milestones row** — chip pins from `bd_milestones` filtered to that phase
- **Overall %** — done initiatives in phase / total in phase

### Per-phase filters (inside each phase card)
- Tag pills: All / Mayday / Neptune / Shared
- "Hide Done" toggle (default on)
Phase-chip filters live at the top of Timeline/Calendar/My Stuff (multi-select, all on by default).

### Behaviors
- **Auto-archive:** an initiative or task with `completed_at + 1 day < now` collapses into a "Completed" expander under its workstream/parent.
- **Notifications:** in-app via existing bell system. Daily check flags overdue tasks, due-today tasks, and overdue initiatives into the existing `notifications` table.
- **RLS:** admin role required for all read/write on `bd_*` tables.
- **Delete phase:** opens a modal that requires typing the exact phase name to confirm. Cascade-deletes all initiatives, links, tasks, and milestones inside.
- **Move initiative across phases:** initiative edit form has a phase selector — change it to relocate.

### Tables
- `bd_phases` (id, name, launch_target_date, position, archived_at, created_by, created_at, updated_at)
- `bd_initiatives` (id, **phase_id**, workstream, title, description, status, tag, owner_id, target_date, budget_cents, priority, position, completed_at, created_by, created_at, updated_at)
- `bd_initiative_links` (id, initiative_id, label, url, position)
- `bd_tasks` (id, initiative_id, title, notes, tag, owner_id, due_date, completed_at, recurrence_interval, recurrence_count, position, created_by, created_at, updated_at)
- `bd_milestones` (id, **phase_id**, title, target_date, position, retired_at, created_by, created_at)
- `bd_settings` (single-row, currently empty after launch_target_date moved to phases)

### Deferred (not v1)
- Comments / discussion threads on initiatives
- File attachments (links cover most needs)
- Budget rollup view (budget shown per initiative; no aggregate yet)
- Non-admin owners and visibility
- SprintBoard / personal_tasks integration
- Email reminders

## Automations System

Replaces single-step "code" workflows (payroll reminders, clip video) with admin-configurable trigger→action rules. Lives as a second tab inside `src/pages/Workflows.js`.

### Architecture
- **`automations` table**: id, name, trigger_type (`schedule`|`event`), trigger_config (jsonb), actions (jsonb array), dedup_key template, is_enabled, run_count, last_run_at
- **`automation_runs` table**: audit log of each execution (status, error, actions_taken)
- **`tasks.automation_id`**: nullable FK linking tasks created by automations
- **`tasks.link_url`**: optional URL for "Go To Work" button on task cards
- **Edge function**: `run-automations` — handles both schedule mode (hourly cron) and event mode (HTTP POST with `{ event, source, payload }`)
- **Dedup**: template-based (`payroll_{{today}}`, `clip_{{video_id}}`) resolved at runtime to prevent duplicate tasks
- **Template resolution**: `{{variable}}` replacement from trigger payload context

### Seeded Automations
- **Payroll Reminder**: schedule trigger, days 1+15, creates task for all admins
- **Clip Video**: event trigger (`new_video` from `More Mayday`), creates task for David Korn with link_url

### Key Files
- `supabase/functions/run-automations/index.ts` — automation engine
- `supabase/functions/workflow-complete-task/index.ts` — handles both workflow tasks and standalone tasks (null guard for `workflow_instance_id`)
- `src/pages/Workflows.js` — Workflows | Automations tab switcher, automation list + detail editor
- `src/lib/workflowSteps.js` — includes `automation` step_key for standalone tasks

## Contractor Portal

Freelancer-facing portal with locked sidebar nav. Accessible when `profile.role === 'freelancer'`.

### Pages
- `fl_dashboard` → `ContractorDashboard.js` — titled "Dashboard": assignments (status filter is a single dropdown, no type emoji), status updates, hours logging, blockers, and an **Earnings** section (2026-09-18) below the cards: current pay period + any past period Payroll hasn't marked paid, with a collapsible paid history. Amounts come from the `contractor_earnings(p_start, p_end)` RPC (hourly → `compute_freelancer_pay`, project → completed assignments' `pay_amount`; PT-day attribution; one-offs excluded since `payroll_one_offs.payee` is free text). Migration `20260918160000_contractor_earnings.sql`. Mobile shows the current period only.
- `fl_assignments` → opens assigned Google Drive folder (external link)
- ~~`fl_submit`~~ removed 2026-09-18 (sidebar upload modal + tour step). The per-card Submit button stays; it's driven by the assignment's `submit_folder_id`, set by whoever creates the assignment.
- ~~`fl_documents`~~ folded into Profile 2026-09-18: `ContractorDocuments` renders with `embedded` as the **Documents** view of `ContractorProfile`. The unsigned-doc badge now sits on the Profile sidebar item and on the Documents view tab; a deep link is `navigateTo('fl_profile', 'documents')` (`initialView` prop).
- `fl_hours` → `FreelancerHours.js` — bi-weekly hour tracking (1st–15th, 16th–end of month)
- `fl_profile` → `ContractorProfile.js` — four views (`usePersistedTab('fl-profile-view')`): **Profile** (avatar, Morty toggle, name, email, specialties, phone, bio), **Payment** (type + rate read-only, method, details), **Documents**, **Password**. No page heading, and the deprecated Title field is gone (sub_role/specialties cover it).
- ~~`fl_notifications`~~ removed from the contractor sidebar 2026-09-18, along with the Notifications block that sat atop the dashboard; contractors use the bell. (`ContractorNotifications.js` still serves the client `cl_notifications` tab.)
- Also: `resources`, `assets` (external), `messages` (Channels removed from the contractor sidebar 2026-09-18)

### Onboarding
- `FreelancerTour` component auto-triggers when `freelancer_profiles.tour_completed_at` is null
- 5-step tour: Dashboard, Assignments, Hours, Assets, Profile
- `AppLayout.js` auto-creates `freelancer_profiles` row if missing during tour check

### Invite Flow
- Admin invites via `Freelancers.js` Team tab → calls `invite-user` edge function
- Invitation stores role, title, payment_type, rate, contract, drive folder, cloud folder restrictions
- On acceptance (`AuthPage.js` setup mode): reads invitation, creates profile + `freelancer_profiles` row with payment data
- **RLS**: `freelancer_profiles` has INSERT policy so freelancers can create their own row during setup

### Key Integration Points
- **Cloud folders**: `cloud-folders` edge function → `CLOUD_API_URL` (`https://assets.maydaystudio.net`) + `CLOUD_API_KEY`
- **Drive folders**: `drive-list-contractor-folders` edge function → lists root + one level of nested subfolders
- **Mascot toggle**: Morty on/off via `profiles.mascot_enabled`, toggle on FreelancerProfile avatar row

## Client Portal (added 2026-07-30)

External customers (`role = 'client'`) get a locked sidebar portal: Dashboard, Review, Messages, Documents, Profile, Notifications (`cl_*` nav keys). Mobile v1 = Dashboard + Messages only. **Calendar is a section at the bottom of the Dashboard (2026-09-18)** — `ClientCalendar` renders with `embedded` inside `ClientDashboard`; the `cl_calendar` tab/nav key was removed, and clicking an own-assignment pill selects + scrolls to that card on the same page.

- **Editor assignment:** admins / Director of Production link editors to clients via `client_editors` — contractors with the `Editor` sub-role (`EDITOR_SUB_ROLES`, legacy titles tolerated) **or the Director of Production themself (2026-09-18, `client_editors_validate` + Clients.js picker)** (admin page `src/pages/Clients.js`, nav key `clients`, gated by `canManageClients()` — admin or director+creative).
- **Assignments:** clients create `contractor_assignments` rows for ONLY their assigned editors (reused `ContractorAssignmentModal` with `mode="client"` + `contractorOptions` from `client_editor_options()` RPC — rates shown read-only). DB `client_assignment_sanitize` trigger forces status/nulls pay spoofing (project-rate stamped server-side); `client_assignment_lock_fields` limits client edits to title/description/due/content_type. Comments shared via `contractor_assignment_comments`.
- **Review loop:** editor submits unlisted YouTube links via "+ Review" on the assignment (ContractorDashboard) → `reviews` row with `assignment_id` + `review_versions` v1/v2/v3 → client's Review tab (`ClientReview.js`, shared `src/components/reviews/ReviewPlayer.js` `mode="client"`) → timestamped comments + verdict buttons ("Submit Changes" / "This looks great!") via `submit_review_verdict()` RPC → editor's Reviews tab (`ContractorReviews.js`, nav `fl_reviews`, editor sub_roles only). Client reviews also appear in staff Reviews page (All | Studio | Client filter). **Reviews-family RLS was rewritten** — was `USING(true)` for all authenticated; now staff-wide via `is_staff()`, client/contractor scoped through the linked assignment.
- **Share a studio review with a client (2026-08-13).** Second path into the client's Review tab, independent of assignments: staff open any review and hit **Share** in the ReviewPlayer top bar (`mode === 'staff'` only), pick client accounts, and rows land in `review_client_shares` (PK `review_id, client_id`; `shared_by` stamped by the `review_share_guard` trigger, which also rejects non-client targets). `is_review_shared_client()` is OR'd into `can_view_review()`, so the shared client gets the whole review family (versions, comments, replies, thumbnails, titles, detail comments) and can comment + submit a verdict — **rename/delete stay blocked** because `review update`/`review delete` are still staff-or-creator. `submit_review_verdict()` now LEFT JOINs the assignment: no assignment → notifies the review's staff creator (`cl_review_verdict`, `link_tab: 'reviews'`) instead of a contractor. Sharing fires `cl_review_ready`, as does each new version on a shared review. Migration `20260813120000_review_client_shares.sql`.
- **Notifications:** DB triggers are the single source of truth for client-created assignments (`cl_*` types → 'clients' push category; frontend must NOT insert client-recipient notifications — clients can't insert into `notifications` at all). Types: `fl_assignment_new`, `cl_assignment_status`, `cl_assignment_completed`, `cl_comment`, `cl_review_ready`, `fl_review_feedback`, `cl_assignment_overdue` (daily cron via `fl_emit_due_notifications`).
- **Calendar:** clients are fenced off `calendar_events` (policies now `NOT is_client()`); `ClientCalendar.js` renders `client_calendar_events()` RPC — own assignments + anonymized busy blocks for their editors' other work.
- **Messages:** `client_message_recipients()` RPC = admins + Creative Director + assigned editors; enforced server-side in hardened `get_or_create_dm` / `create_group_conversation` + `conversation_participants` INSERT policy. Clients are 1:1-DM only (no groups).
- **Documents:** `client_documents` table + private `client-documents` bucket (paths `<clientId>/…`, invite contracts under `pending/…`). Admin-issued signing/reference docs (attestation flow) + client self-uploads. `claim_client_contract()` RPC runs at signup (AuthPage client branch).
- **Folders are LINK-ONLY (reworked 2026-09-17):** `client_profiles.drive_folder_url` is the client's **Assets folder** (branding assets; column name unchanged, set in ClientProfile) — shown as an **Assets** button on every assignment, client side and editor side (`editor_client_drive_folder()` RPC). Each client-created assignment REQUIRES `contractor_assignments.project_folder_url` (that project's footage/materials; client-editable, enforced by `client_assignment_sanitize` / `client_assignment_lock_fields`). To complete, the editor pastes the exact location of the finished project into `delivery_url` — no Drive upload for client projects. `client_assignment_delivery_gate` trigger refuses `completed` on a client-created row without it (admin-tier exempt); the `cl_assignment_completed` notification carries the link and the client sees a **Finished project** button. Staff-created assignments keep `asset_url` + the upload flow. Migration `20260917130000_client_assignment_folders.sql`.
- **Gotchas:** `contractor_assignments` FK constraints kept legacy `freelancer_assignments_*` names — PostgREST embed hints must use those (or column-name hints). Client "View as…" impersonation NOT supported (contractor-only).
- Migrations: `20260730100000`–`20260730160000` (7 files).

## Agency Portal

Read-only deliverables portal for the ad agency partner. Role `agency` (distinct from `partner`, which is the Business Dev roadmap portal). Invite via AdminPanel role select.

- **Page**: `src/pages/AgencyPortal.js` — locked, sidebar-free page rendered by an early return in `AppLayout.js` / `AppLayoutMobile.js` when `isAgency`
- **Data access (RLS)**: agency accounts are excluded from the staff-wide policies on `sponsors`, `sponsor_deliverables`, `sponsor_campaigns`, `campaign_briefs`, `revenue_events`, `beat_sheets`, `calendar_events`, `read_slot_limits` via `is_agency()`. They read through trimmed SECURITY DEFINER views: `agency_deliverables` (no pay / notes / ad_copy) and `agency_briefs` (no source_text)
- **Comments**: `agency_comments` table, polymorphic (`entity_type` deliverable|proposal). BEFORE INSERT trigger forces `author_id = auth.uid()` and snapshots `author_role` — never trusted from the client. Shared UI: `src/components/AgencyThread.js` (used by portal + admin Deliverables page)
- **Proposals**: agency submits into existing `ad_read_proposals` (own rows only, pending only); admins confirm/decline with the existing flow
- **Notifications**: `get_notification_summary` returns `agency_unresolved_count` for admin-tier roles (admin + both directors). A thread is unresolved when the latest comment is from the agency; a pending agency proposal with no replies is also unresolved. Any admin-tier reply clears it for everyone. Badge shows on the Deliverables sidebar tab; amber dots on rows/proposals in Deliverables.js
- **Freshness**: portal polls every 20s + realtime on `agency_comments` / own `ad_read_proposals` (deliverable rows are outside the agency's RLS read set, so no postgres_changes for them)
- Migration: `20260709190000_agency_portal.sql`

## Whiteboard (added 2026-08-11)

MS-Paint-style drawing tool in the **Filming** nav folder (`whiteboard` key → `src/pages/tools/Whiteboard.js`). Not related to the older `src/pages/editors/Whiteboard.js`, which is the pen-only doc-editor used by Ideation.

- **Shared boards:** one row per board in `whiteboards`; the whole scene is a vector object list in `content` (`{ objects: [...], bg }`). Every staff member (`is_staff()`) can open and draw on any board; only the creator or an admin can rename/delete (delete via RLS, rename via the `whiteboards_guard_update` trigger, which also pins `created_by`).
- **Object model** (not a bitmap — that's why zoom stays crisp and eraser/fill act on whole objects): `stroke`, `line`, `arrow`, `rect`, `ellipse`, `text`, `image`.
- **Tools:** select (move / marquee / resize handles), pan, pen, eraser, line, arrow, rectangle, ellipse, text, fill.
- **Fill is three-way:** clicking a vector shape sets its `fill` (stays editable geometry); clicking inside a region closed by pen strokes rasterizes the barrier objects, scanline-floods from the click, and commits the mask as an `origin:'fill'` image object; an open region falls through to painting the board background. Barrier pixels are transparent in the result, so strokes and anything inside the region still show through, and prior fills are excluded from the barrier pass so a region can be re-filled. Fills are raster — they don't reflow if you later move the strokes that bounded them, and they soften past the capture resolution (`MAX_FILL_SCALE`). Keyboard: V/H/P/E/L/A/R/O/T/F, ⌘Z / ⇧⌘Z, ⌘A, ⌘D duplicate, ⌘C / ⌘X / ⌘V, Delete, Escape, Space-drag to pan, ⌘+scroll to zoom.
- **Clipboard:** ⌘C/⌘X/⌘V move objects through an in-app clipboard ref, not the system clipboard — the `paste` event checks for an image first and only falls through to board objects when there isn't one, so pasting a screenshot still works right after copying a shape.
- **Images:** paste, drop, or the toolbar picker → public `whiteboard-images` bucket (`<boardId>/<uuid>.<ext>`, 10 MB, image mime types only). Export renders the scene to a PNG at 2×.
- **Persistence:** debounced autosave (900 ms) + flush on unmount. No live multiplayer — a realtime subscription on the row shows a "someone else saved" banner offering to load their version instead of silently clobbering it.
- Desktop-only (`whiteboard: 'excluded'` in `src/config/mobileNavConfig.js`; the Filming folder is already stripped from the mobile nav).
- Migration: `20260811120000_whiteboards.sql`.

## User Deactivation (added 2026-09-08)

Strict-admin-only account disable without deletion. AdminPanel → Team tab: Deactivate/Reactivate buttons (`isStrictAdmin` only; self-target blocked).

- **Column:** `profiles.deactivated_at` (timestamptz, null = active). Strict-admin-only via `profiles_lock_admin_fields` trigger, which also gained a service-role bypass (`auth.uid() is null` → allow) — this un-breaks service-role/migration profile updates generally.
- **Edge function `deactivate-user`:** verifies caller `role = 'admin'`; deactivate = auth ban (`ban_duration: '87600h'`) + set `deactivated_at` + GoTrue admin logout (session revoke, non-fatal); flag-write failure rolls the ban back. Reactivate = unban + clear flag.
- **Login block:** ban stops new logins ("This account has been deactivated…" mapped in `AuthContext.signIn`); `fetchProfile` nukes the session if it sees `deactivated_at`, so an active session is kicked on its next profile fetch.
- **Visibility:** history stays attributed (single-row `.eq('id', …)` lookups untouched); LIVE surfaces filter `.is('deactivated_at', null)` — ~25 frontend files (pickers, rosters, recipients, payroll, presence, View-as), recipient fan-outs in ~10 edge functions + `shared/workflow-engine.ts` (`notifyAdminsTaskHeld`), client RPCs (`client_editor_options`, `client_message_recipients`), and DB fan-outs (`alert_failed_cron_jobs`, `fl_overtime_check_on_start`, `overtime_check_on_task_complete`). Convention: any NEW people-list query must add the filter; dual-use lists (picker + historical attribution, e.g. Calendar `hubUsers`, accounting breakdown) select `deactivated_at` and filter at render.
- Migrations: `20260908120000_user_deactivation.sql`, `20260908130000_deactivation_fanout_filters.sql`.

## Beat Sheet views (added 2026-09-08)

An open beat sheet (`src/pages/Production.js`) has three views, switched from a segmented control in the config bar and remembered per user via `usePersistedTab('production-view')`. Desktop only — `ProductionMobile.js` still shows the beat sheet alone.

- **Beat Sheet** — unchanged: the page keeps its own scroll.
- **Research** — a Google Docs style rich-text editor, one document per sheet.
- **Split** — both side by side with a draggable divider (ratio in `localStorage` under `production-split-ratio`, clamped 0.22–0.78, double-click to even out) and a Swap button (`production-split-swapped`).

### How the panes are wired
Research and Split render the same flex row; pane order is CSS `order` and the hidden pane in Research view is `display: none`, never unmounted. That's deliberate — remounting would refetch the doc and throw away Tiptap's undo history every time somebody switched or swapped. Only Beat Sheet ↔ the other two unmounts the editor (and `useAutoSave`'s cleanup flushes on the way out). Those two views also swap `styles.page` for `styles.pageFullHeight`, pinning the page to the viewport so the document toolbar can't scroll away.

### The research document
- `beat_sheet_research_docs`, one row per sheet with a **unique** `beat_sheet_id` — that constraint is what makes "exactly one doc" true, and `ensureResearchDoc` treats a `23505` on insert as "the other tab won" and re-selects rather than erroring.
- Created lazily the first time Research or Split is opened, so sheets nobody researches never get a row.
- `summary` column backs the Summary block in the left rail; the outline below it is derived from the document's headings on every transaction, never stored.
- Content is `{ html }`, the same shape the other doc-editor tables use, saved by the shared `useAutoSave`.

### Editor chrome
`src/pages/editors/doc-editor/gdocs/` — `GDocsEditor.tsx` (Tiptap instance, load/save, templates, summary), `GDocsToolbar.tsx` (one scrolling row, Docs order), `menu.tsx` (File/Edit/View/Insert/Format/Tools menu-bar primitives), `OutlinePane.tsx`, `TemplateGallery.tsx`. It reuses the existing extensions, dialogs, `CommentPanel`, `FindReplace`, `LinkBubble`, `EditorContextMenu`, and `ExportMenu`'s export helpers rather than forking them; `DocumentEditor.tsx` (the older chrome used by resource/show/concept docs) is untouched. Shortcuts are scoped to the pane by a `contains(document.activeElement)` check, so ⌘F in a beat textarea doesn't open the document's find bar.

### Templates
`research_doc_templates` — staff read, admin write (`is_admin()`). A blank doc opens straight onto the gallery ("pick a template or start from scratch"); picking one over existing content needs a second click. Admins can save the current doc as a template, rename, and delete. Four are seeded: Topic Research, Interview Prep, Fact Check, Competitor Breakdown.

Both new tables are `is_staff()`-scoped, deliberately narrower than the `auth.uid() IS NOT NULL` rule `beat_sheets` itself still carries. Migration `20260908140000_beat_sheet_research.sql`.

## Film Queue (added 2026-09-10)

Concept-to-shoot pipeline for filmed content that skips Projects entirely: idea → beat sheet → review → approval → session packing → call sheet. NO project card anywhere in this path. **The pipeline stops at approval (2026-09-17)** — editing is handed out separately from the Dashboard's `+ Assignment` menu and linked back to the slate item.

### Ideas → Slate (UI says "Slate"; code/tables still say film queue)
- Ideas select mode has two tag-gated actions (2026-09-16): **Add to Projects (N)** shows only when a selected idea carries a Projects tag (`Trevor May Baseball Videos` / `Podcast Only`); **Add to Slate (N)** shows for everything else (Mayday / Short Form / Ad, plus untagged and custom-tagged ideas, which default to the Slate). A mixed selection shows both, each sending only its own subset. Same rule on the per-row Status column: one destination → a direct `+ Project` / `+ Slate` button, both → the `+ Add` menu. `destinationsFor()` in `Ideas.js` is the single source of that rule; `IDEA_TAG_TO_QUEUE_TYPE` no longer maps TM Baseball (the `tm_baseball` queue type survives for hand-queued sheets).
- New seeded `Ad` idea tag. Queue types + default minutes: `mayday` 25, `tm_baseball` 25, `short_form` 5, `ad` 5. **Podcast and TM Baseball ideas are Projects-only.**
- **Sent ideas stay on the board** (both buckets), flagged **In Production** (`write_ideas.project_id`) or **On Slate** (`write_ideas.film_queue_item_id`, migration `20260916120000_idea_slate_link.sql`, ON DELETE SET NULL). Bulk Add to Projects links instead of deleting now, matching the Up Next Add Project path. Re-clicking the chip confirms and calls `film-queue` `unsend_ideas` (service role so any staff can undo, not just the card creator): Projects → deletes the card (stage assignments cascade; `projects_delete_cleanup_tasks` sweeps tasks + sprint cards); Slate → deletes the beat sheet (cascades to the queue item, whose trigger sweeps tasks), and both drop the assignees' `my_tasks` notifications. Refused once the Slate item is `filmed` or packed into a locked session. Deleting the card / sheet elsewhere also frees the idea via the FK.
- The Slate details modal captures per idea: type and writer (picker lists all active staff). **No editor** — that's chosen later on the editing assignment. Confirm calls the `film-queue` edge function's `enqueue_ideas` (service role — staff can't insert `tasks`/`film_queue_items` under RLS): creates the beat sheet (Mayday Video template for `mayday`, blank otherwise; beat-sheet tag from `QUEUE_TYPE_TO_SHEET_TAG`; `status='drafting'`; appended to Active), a `film_queue_items` row (idea context/titles preserved in `source_context`/`source_titles`), the writer's `fq_write` task + notification, then links the idea. Re-sending an already-linked idea is rejected server-side.
- `IdeasMobile.js` still has the old behavior (Add to Projects only, no tag gating, deletes the idea) — not updated.

### Beat sheet fields
- `beat_sheets` gained `status` (`drafting`/`ready_for_review`/`approved`, on ALL sheets), `estimated_minutes`, `film_date` (packer-set, never by hand), `approved_at`. Edited in the Production config bar (status select + minutes input; film date is a read-only chip). A manual flip to approved stamps `approved_at`; leaving approved clears it.
- Assignments deliberately do NOT live on `beat_sheets` — the writer sits on `film_queue_items` and is edited only in the Film Queue item modal (admin-tier). `film_queue_items.editor_id` is **deprecated and unused** as of 2026-09-17; editors live on the editing assignment.

### Task pipeline (`tasks` rows, `step_key` `fq_*`, `related_entity_type='film_queue_item'`)
Two steps only, both about the beat sheet:
- `fq_write` (writer) → complete → sheet `ready_for_review` + `fq_review` task for Trevor (`FILM_QUEUE_REVIEWER` in `shared/film-queue.ts`, same UUID as `RESEARCH_SCOPE_OWNER`).
- `fq_review` → complete → `approved` + `approved_at`, item waits in The Line. **No follow-up task** — the shoot happens, then the edit goes out as its own assignment.
- **Removed 2026-09-17:** `fq_send`, `fq_edit`, `fq_draft_review`, along with `filmQueueCompletionGate` and the MyTasks inline link inputs / assign-editor modal / draft-review picker. The migration silently closed any still-open rows (`status='skipped'`, sprint cards deleted).
- Transitions live in `supabase/functions/shared/film-queue.ts` (`advanceFilmQueue`; the reviewer task is built by `createReviewerStepTask`), wired into `workflow-complete-task`. Gotcha: TaskEditModal's direct client status write bypasses the edge function, so it skips fq transitions (same pre-existing gap as project stage advance).
- **Manual status flips drive the chain too (2026-09-16).** The Production config bar's status dropdown writes the column, then calls `film-queue` `sync_sheet_status`, which completes the open task the flip implies (`ready_for_review` → fq_write; `approved` → fq_write then fq_review) with the same bookkeeping as task completion and runs `advanceFilmQueue`, and creates a missing `fq_review` if the chain never had one. Approving outright now needs no follow-up task.
- fq tasks appear in My Tasks even for sprint-routed users (`film_queue_item` passes the routing filter, like `research_scope`). MyTasks renders **Open Beat Sheet** on `fq_write`/`fq_review` via the `fqMeta` lookup.

### Editing assignments (added 2026-09-17)
Editing is handed out from the Dashboard's `+ Assignment` button (`AssignmentMenuButton` → the single `src/components/AssignmentModal.js`, **unified 2026-09-18**: one Assign-to list of members + contractors, a Task type select with **Edit a Video** carrying the contractor field set — asset link, Slate item, submission folder, due time, pay). **Routing is by assignee role, not task type:** members → `tasks` rows via `assign-task`, contractors → `contractor_assignments` rows (`assignment_type` from the task type); a mixed pick creates both, one row per person. Members handed Edit a Video get everything but pay (due time folds into `tasks.due_date`, the submission folder is appended to the description). `MemberAssignmentModal` is gone (`PeopleChips` moved to its own file); `ContractorAssignmentModal` survives only for editing existing rows (Workflows Progress, mobile) and client mode. Mobile create paths (WorkflowsMobile FAB, ContractorsMobile FAB) open the unified modal too. Both modals set `fontFamily` on their overlay — they portal to `<body>`, which never gets DM Sans. The optional **Slate item** field is the shared `src/components/SlateItemPicker.js`; the client-mode contractor modal never shows it.
- **Link = filmed, completion = done.** Setting `film_queue_item_id` flips the item to `state='filmed'` (stamping `filmed_at`); the assignment completing flips it to `done` and copies the finished link into `cut_url` (contractor `delivery_url`/`asset_url`, member `completion_payload.cut_url`/`link_url`). All of it is DB triggers (`film_queue_assignment_sync`) on `contractor_assignments` and `tasks`, so **every** completion path is covered — including the contractor dashboard and TaskEditModal's direct write.
- **One assignment per item**, enforced by partial unique indexes plus the cross-table `film_queue_item_link_guard` trigger. A member assignment with a slate item is capped at one assignee (blocked client-side and in `assign-task`).
- **Unlink or delete → the item stays `filmed`** and becomes linkable again (a `done` item reverts to `filmed`).
- Pickers read `slate_items_for_assignment(p_include)` — approved, not `done`, not already linked (`p_include` keeps the current link visible when editing). `assign-task` re-checks server-side with the service role (that RPC is `is_staff()`-gated, so it's useless there) and the link guard is the final backstop.
- `slate_item_assignments()` feeds the Film Queue view the holder's name per item — staff can't read `contractor_assignments` or other people's `tasks` under RLS, and it returns no pay or descriptions.
- Clients are fenced out: `client_assignment_sanitize` nulls `film_queue_item_id` on insert and `client_assignment_lock_fields` refuses to let them change it.

### Film Queue view (4th Projects tab, `src/pages/projects/FilmQueue.js`)
- Top counts: drafting / awaiting review. **Next Session**: manual date (admin sets it in the header; stored in `film_sessions`); pre-lock the pack is derived client-side, post-lock rows come from stamped `session_id`/`slate_order`. **The Line**: approved + unpacked, ads floated first, then oldest `approved_at`. **In Edit**: `state='filmed'` items (an editing assignment is out on them), naming whoever holds it, until that assignment completes. No drag ordering anywhere.
- Packer: fill to 60 min / 6 items, whichever first, as a strict prefix of the line (overflow keeps its place at the front). KEEP `src/lib/filmQueue.js` and `supabase/functions/shared/film-queue.ts` in sync.
- Dashboard (admin): "N beat sheets awaiting review" card in the Today block, deep-links via `localStorage.projects_view='film_queue'`.

### Sessions, call sheets, 6am job
- `film_sessions` (manual `session_date`, `locked_at`), `call_sheets` (frozen `items` jsonb snapshot — later sheet edits don't rewrite history). Call Sheets page: `src/pages/CallSheets.js`, nav key `call_sheets` in the Pre-Production folder, staff view + admin **Lock & Generate Now** (`lock_session` with `force: true`); desktop-only (`call_sheets: 'excluded'` in mobileNavConfig).
- Cron `film-session-lock-pdt`/`-pst` at 13:05/14:05 UTC both hit `film-queue` `lock_session`; the function gates on PT hour === 6, so exactly one runs per day year-round. Lock: pack → stamp `session_id`/`slate_order`/`film_date` → generate call sheet → compile the prompter session (pushScript beat format + slate title cards + hard breaks) into Trevor's `teleprompter_scripts` as "Film Session — YYYY-MM-DD" → notify admins (`type='automation'`). A prompter push failure notifies immediately. Items approved after the lock roll to the next session automatically (locked sessions never repack).
- RLS: staff read / admin write on `film_sessions`, `film_queue_items`, `call_sheets`; all pipeline writes go through service-role edge functions.
- Migrations: `20260910120000_film_queue.sql`, `20260910130000_cron_film_session_lock.sql`, `20260910140000_call_sheets_nav.sql`, `20260917140000_slate_editing_assignments.sql`. Deploy: `film-queue`, `workflow-complete-task`, `assign-task`.

## Style Guides (added 2026-09-18)

Review timeline comments distilled into editable rule cards, one guide per client plus one Mayday guide. Rule cards are grouped into eight fixed categories (Pacing & Cuts, Audio & Music, Graphics & Text, Sponsor & Brand, Transitions & Effects, Story & Content, Color & Look, Delivery & Export).

- **Routing:** `style_guide_client_for_review(review_id)` — a review born from a client assignment or shared to a client feeds THAT client's guide (staff comments on it included); everything else feeds the single `scope='mayday'` guide. Guides are created lazily by the edge function.
- **The AI only suggests.** `style-guide` edge function (`update_from_review` / `backfill`, admin-tier JWT or `x-cron-secret`) sends each review's unprocessed comments to Claude with the guide's existing cards; reusable notes become `status='suggested'` cards or add an evidence ref (+`ref_count`) to an existing card. Dismissed cards still absorb matches so a rejected idea never resurfaces as new. `review_comment_insights` (one row per comment) makes it idempotent — pressing Update again only reads new comments.
- **Surfaces:** ReviewPlayer top bar **Style Guide** toggle (all modes except demo; read-only third column beside the notes showing the guide this review feeds, resolved via the routing RPC + RLS, open state in `localStorage['review-guide-open']`) and **Update Style Guide** (staff mode + admin-tier; result banner has "Open guide →"); Reviews page **Reviews | Style Guides** view switch (`usePersistedTab('reviews-view')`) with a chip per guide; ClientDashboard **Style Guide** header toggle (client mode); ContractorDashboard **Style Guide** button on client-project rows (read-only modal, guides of `client_editors`-linked clients). Shared component `src/components/StyleGuidePanel.js` (`mode` admin | client | readonly; evidence drawer per card via `style_guide_rule_refs`).
- **Permissions:** admin-tier sees all cards on all guides and accepts/dismisses; everyone else sees `active` cards only (RLS). Clients may add manual cards and edit/delete active cards on their own guide — the `style_guide_rules_guard` trigger forces client inserts to active/manual, blocks clients from touching status/ref_count/source, and treats an admin editing a suggestion's text as an accept. Staff (member) get the Mayday guide read-only. Refs / insights / runs are service-role-write only.
- Tables: `style_guides`, `style_guide_rules`, `style_guide_rule_refs`, `review_comment_insights`, `style_guide_runs`. Migration `20260918120000_style_guides.sql`. Deploy: `style-guide`.
- Decided 2026-09-18 after ship: conflicts between suggestions are resolved by hand (no detection), the guide updates ONLY from the button (no verdict hook, no cron), and there are NO style-guide notifications.
- Backfill of the pre-existing 301 comments was run at ship; to re-run for new history use `{ action: 'backfill' }` (safe, skips processed comments). Run reviews for the SAME guide sequentially — parallel runs can't see each other's new cards and would duplicate.

## Flightline (suite app, live 2026-09-22)

Pitch-tracer production app owned by the separate Flightline repo (`../Flightline`; its `docs/MAYDAY_STUDIO.md` holds the auth contract). Mayday only hosts the shared Dashboard at `/flightline` (`src/pages/flightline/FlightlineDashboard.js`, intercepted in `App.js` before the layout; `/radar` still aliases) and the Mac package under `public/downloads/flightline/`. Calls go straight from the browser to `REACT_APP_FLIGHTLINE_SERVICE_URL` with the Mayday bearer token (`src/lib/flightline.js`); **access is the Flightline service's own grant, not a Mayday role** — no migration, no RLS.

- **Launcher card** uses Flightline's own brand, not a Mayday tone: palette + logo path live in `FLIGHTLINE` in `src/lib/suiteApps.js` (mirror of the Flightline repo's `web/src/styles.css` `:root` and `public/flightline.svg`, copied to `public/flightline-logo.svg`). The `flightline` tint carries card-level overrides (`cardBg`, `nameColor`, `descriptionColor`, `taglineFont`) that `AppCard` honours when present; `icon` on a registry entry replaces the monogram.
- **Mobile progress sheet** (`src/pages/flightline/FlightlineMobile.js`): read-only. Drawer row "Flightline" (above Apps, `MobileDrawer.onOpenFlightline`) for every non-client account → `FullScreenSheet`. Polls `/api/dashboard` **plus `/api/jobs` for every project** every 10s while open (pilot-scale fan-out, deliberate). Projects view: strip (running / queued tasks, workers with a no-worker warning, media), then per project a finished-clip bar (`counts.approved + rendered` over `clip_count`), state chips, a **Processing** section (live clips with %, the `service_tasks` row behind each — analysis/render/refit/restore, running/queued/failed — and editing leases from `dashboard.leases`), and **Uploads · last 24h** (jobs with `origin='upload'`, `uploaded_by`, `created`). Tap in for every clip with task line, latest export status (`exports[]`), reviewer, uploader. **Uploads are only visible once they've landed** — the service keeps in-flight bytes in a `.partial` file it doesn't report. No approve/upload/create on the phone by decision. Ungranted accounts see the service's own error.

## Admin Mode / Work Mode

Two sidebar modes toggled via button at bottom of sidebar (`AppLayout.js`).
- **Work Mode** (default): everyday pages (Dashboard, My Tasks, Messages, Projects, etc.)
- **Admin Mode**: admin-only pages — Assignments, Payroll, Analytics, Accounting, Business Dev, Contractors, Workflows, Jobs
- Non-admins are pinned to Work Mode
- `ADMIN_PAGE_KEYS` array controls which pages appear only in Admin Mode
- `ADMIN_ESSENTIAL_KEYS` (Dashboard, My Tasks, Messages) appear at top of Admin Mode sidebar too
- Below the mode toggle: "Gerald" button (`isStrictAdmin` only) opens the Mayday Assistant at assist.mmcreate.io in a new tab

## Auth Pages
- `AuthPage.js` (desktop) + `AuthPageMobile.js` (mobile)
- Branding: `/logo.png`, "Mayday Studio" title, "by Mayday Media" subtitle
- Modes: login, setup (new account), forgot password, reset password
- Setup flow reads `invitations` table to get role, title, payment info, drive folder assignment
