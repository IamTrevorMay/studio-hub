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
- **Sub-roles** (`profiles.sub_role`): Director → `communications` | `creative`; Contractor → the former "titles" (Long Form Editor, Short Form Editor, Podcast Editor, Graphic Designer, Developer, Writer, Producer, Production/Camera). Admin/member have none. Sub-roles are display/organizational only for now — no feature gating yet (that's the next phase).
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
- `fl_dashboard` → `FreelancerDashboard.js` — assignments, status updates, hours logging, blockers
- `fl_assignments` → opens assigned Google Drive folder (external link)
- `fl_submit` → file upload modal (drag-drop to shared Drive folder via `drive-upload-init`)
- `fl_documents` → `FreelancerDocuments.js` — document signing and reference docs
- `fl_hours` → `FreelancerHours.js` — bi-weekly hour tracking (1st–15th, 16th–end of month)
- `fl_profile` → `FreelancerProfile.js` — payment method, contact info, avatar, Morty toggle
- `fl_notifications` → `FreelancerNotifications.js` — alerts with type icons
- Also: `resources`, `assets` (external), `channels`, `messages`

### Onboarding
- `FreelancerTour` component auto-triggers when `freelancer_profiles.tour_completed_at` is null
- 7-step tour: Dashboard, Assignments, Submit, Documents, Hours, Assets, Profile
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

External customers (`role = 'client'`) get a locked sidebar portal: Dashboard, Calendar, Review, Messages, Documents, Profile, Notifications (`cl_*` nav keys). Mobile v1 = Dashboard + Messages only.

- **Editor assignment:** admins / Creative Director link editor contractors (sub_role in `EDITOR_SUB_ROLES` = Long/Short Form/Podcast Editor) to clients via `client_editors` (admin page `src/pages/Clients.js`, nav key `clients`, gated by `canManageClients()` — admin or director+creative).
- **Assignments:** clients create `contractor_assignments` rows for ONLY their assigned editors (reused `ContractorAssignmentModal` with `mode="client"` + `contractorOptions` from `client_editor_options()` RPC — rates shown read-only). DB `client_assignment_sanitize` trigger forces status/nulls pay spoofing (project-rate stamped server-side); `client_assignment_lock_fields` limits client edits to title/description/due/content_type. Comments shared via `contractor_assignment_comments`.
- **Review loop:** editor submits unlisted YouTube links via "+ Review" on the assignment (ContractorDashboard) → `reviews` row with `assignment_id` + `review_versions` v1/v2/v3 → client's Review tab (`ClientReview.js`, shared `src/components/reviews/ReviewPlayer.js` `mode="client"`) → timestamped comments + verdict buttons ("Submit Changes" / "This looks great!") via `submit_review_verdict()` RPC → editor's Reviews tab (`ContractorReviews.js`, nav `fl_reviews`, editor sub_roles only). Client reviews also appear in staff Reviews page (All | Studio | Client filter). **Reviews-family RLS was rewritten** — was `USING(true)` for all authenticated; now staff-wide via `is_staff()`, client/contractor scoped through the linked assignment.
- **Share a studio review with a client (2026-08-13).** Second path into the client's Review tab, independent of assignments: staff open any review and hit **Share** in the ReviewPlayer top bar (`mode === 'staff'` only), pick client accounts, and rows land in `review_client_shares` (PK `review_id, client_id`; `shared_by` stamped by the `review_share_guard` trigger, which also rejects non-client targets). `is_review_shared_client()` is OR'd into `can_view_review()`, so the shared client gets the whole review family (versions, comments, replies, thumbnails, titles, detail comments) and can comment + submit a verdict — **rename/delete stay blocked** because `review update`/`review delete` are still staff-or-creator. `submit_review_verdict()` now LEFT JOINs the assignment: no assignment → notifies the review's staff creator (`cl_review_verdict`, `link_tab: 'reviews'`) instead of a contractor. Sharing fires `cl_review_ready`, as does each new version on a shared review. Migration `20260813120000_review_client_shares.sql`.
- **Notifications:** DB triggers are the single source of truth for client-created assignments (`cl_*` types → 'clients' push category; frontend must NOT insert client-recipient notifications — clients can't insert into `notifications` at all). Types: `fl_assignment_new`, `cl_assignment_status`, `cl_assignment_completed`, `cl_comment`, `cl_review_ready`, `fl_review_feedback`, `cl_assignment_overdue` (daily cron via `fl_emit_due_notifications`).
- **Calendar:** clients are fenced off `calendar_events` (policies now `NOT is_client()`); `ClientCalendar.js` renders `client_calendar_events()` RPC — own assignments + anonymized busy blocks for their editors' other work.
- **Messages:** `client_message_recipients()` RPC = admins + Creative Director + assigned editors; enforced server-side in hardened `get_or_create_dm` / `create_group_conversation` + `conversation_participants` INSERT policy. Clients are 1:1-DM only (no groups).
- **Documents:** `client_documents` table + private `client-documents` bucket (paths `<clientId>/…`, invite contracts under `pending/…`). Admin-issued signing/reference docs (attestation flow) + client self-uploads. `claim_client_contract()` RPC runs at signup (AuthPage client branch).
- **Drive delivery is LINK-ONLY:** client pastes their folder URL into `client_profiles.drive_folder_url` (ClientProfile); editors read it via `editor_client_drive_folder()` RPC and upload manually, then click Complete.
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
