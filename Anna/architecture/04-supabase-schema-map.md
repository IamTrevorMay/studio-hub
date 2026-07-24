---
title: Supabase Schema Map
last_updated: 2026-07-15
tags: [architecture, database, supabase, rls, schema]
---

# Supabase Schema Map

The data model. This is a **map** — where table groups live and how to find the
authoritative shape — not a column-by-column dump. The source of truth is
`supabase/migrations/` (358 files as of writing). Read the migration named after
the feature when you need exact columns.

## Two Supabase projects

- **Main** (read-write): everything below. Client is `src/supabaseClient.js`
  (`REACT_APP_SUPABASE_URL` / `REACT_APP_SUPABASE_ANON_KEY`). Project ref
  `ytfjkoxowfskuibdsfea` (visible in cron migration URLs, e.g.
  `20260714000100_cron_ashley_read.sql`).
- **Triton** (read-only): briefs / cards from Triton Apex. Client is
  `src/tritonClient.js` (`REACT_APP_TRITON_SUPABASE_URL` /
  `_ANON_KEY`) — **null if the env vars are unset**, so guard with
  `if (tritonSupabase)`. SSO into Triton is via the `triton-link` edge function.
  The `briefs` table lives in the **"Triton Tools"** project
  (`xgzxfsqwtemlcosglhzr`), *not* "Triton Shared" (`ovplsvsxteowscghjteb`) —
  `tritonClient` points at Triton Tools. Row shape: `{ date (date), title,
  summary, content (HTML, ~700KB), metadata }`, one per calendar day.

## Finding a table's definition

Migrations are timestamp-prefixed (`YYYYMMDDHHMMSS_name.sql`). Grep by feature:
`ls supabase/migrations | grep -i <feature>`. Do not assume a column exists —
later migrations `ALTER` earlier tables constantly (e.g. `sponsor_deliverables`
gains `review_status`, `film_status`, `video_url`, `post_date` across many
files).

## Table groups (and their defining migrations)

### Identity & profiles
- `profiles` — one row per user, PK = `auth.users.id`. Holds `role`, `nickname`,
  `full_name`, `status`, `last_seen_at`, `posting_allowed`,
  `mascot_enabled`, `desktop_notifications_enabled`, `notification_prefs`,
  `assigned_drive_folder_id`. The `role` CHECK constraint is widened by many
  migrations (latest full set in `20260709190000_agency_portal.sql`).
- `invitations` — pending invites (role, title, payment info, drive folder).
  Consumed by `AuthPage` setup flow and the `invite-user` function.
- `nav_config` — single-row sidebar config (JSON), edited by admins.

### Content pipeline
- `projects` — concept→published pipeline.
- Ideas/ideation, beat sheets (Production), screenplays, research docs — spread
  across feature migrations (`write_ideas_context`, `beat_sheet_asset_review`,
  `idea_titles_ratings`, `canvases`).
- `calendar_events`, `daily_itinerary`, read slots / beat sheets — calendar.

### Platform metrics & analytics
- `platform_accounts` — connected channels (YT/IG/FB/TikTok/Twitch/etc.).
- `platform_daily_metrics`, `audience_snapshots` — per-day time series, keyed on
  the **PT calendar day** (see `sync-*` functions and `src/lib/ptDate.js`).
- YouTube dimensions tables (`backfill-youtube-dimensions`,
  `sync-youtube-dimensions`) power the Studio-Advanced replica.
- `admin_goals` — daily IG-story posting goals ("Do this more" widget).

### Sprints / tasks
- `sprints`, `sprint_goals` (`20260327200000_create_sprint_tables.sql`).
- `personal_tasks` — the Sprint/personal card board (assistant-create-card
  inserts here). Routed via `route_tasks_to_sprint` / `sprint-task-sync`.
- `tasks` — automation-created + standalone tasks; `tasks.automation_id` FK,
  `tasks.link_url` for the "Go To Work" button.

### Research
- `research_feeds` (RSS news + newsletters, `source_type` column),
  `research_articles`, `research_trends`, `research_inbox_state`.
- Trends generated daily by `generate-trends`; feeds by `fetch-rss`. Newsletters
  are RSS-only (no Mailgun).

### Roadmap page (`roadmap_*`) — CURRENT model (rebuilt 2026-07-24)
- `roadmaps` (name, deadline_name, deadline_date, position) →
  `roadmap_milestones` (roadmap_id, title, target_date, completed_at, position) →
  `roadmap_tasks` (milestone_id, title, description, due_date, completed_at, position).
  Migration `20260724170000_roadmap_rebuild.sql`. Cascade FKs delete the tree.
- **RLS:** read = `is_roadmap_viewer(auth.uid())` (admin-tier **or** `partner`);
  write (insert/update/delete) = `is_admin(auth.uid())` only. `created_by` is
  stamped server-side by a BEFORE INSERT trigger (`roadmap_set_created_by`) — the
  client can't spoof it.
- **Milestone→tasks cascade lives in the DB:** trigger
  `roadmap_milestone_cascade` (AFTER UPDATE OF completed_at) auto-completes a
  milestone's still-open tasks when it's checked off. Un-checking a milestone
  deliberately leaves tasks as-is (no upward auto-complete). Both `BusinessDev.js`
  and `BusinessDevMobile.js` just `fetchAll()` after a milestone toggle to reflect it.
- The page (key `business_dev`, nav label "Roadmap") = 2/3 roadmaps list + 1/3
  Goals + Notes (admin only; mobile stacks them). Goals still read `goals` /
  `monthly_goals` (scope='bd') + `platform_daily_metrics` rollups; Notes read
  `bd_user_notes`. All preserved verbatim from the old page.

### Business Dev (`bd_*`) — DORMANT after the Roadmap rebuild (2026-07-24)
- `bd_phases`, `bd_initiatives`, `bd_initiative_links`, `bd_tasks`,
  `bd_milestones`, `bd_settings`
  (`20260503000000_create_business_dev.sql`, `..._phases.sql`). **Left in the DB
  intentionally (not dropped), but the rebuilt Roadmap page no longer reads or
  writes them.** Consider dropping later once confirmed unused.
- `src/lib/bdAttention.js` (tag/status metadata, PT "Needs Attention" buckets,
  `syncBdTaskToBacklog` personal_tasks mirror) is now **orphaned** — nothing on the
  rebuilt page imports it. The `personal_tasks`-backlog integration and the
  `20260503000001_cron_business_dev_notifications.sql` cron both scan the now-empty
  `bd_tasks`/`bd_initiatives` — dead but harmless; flagged for cleanup.

### Automations & workflows
- `automations` (trigger_type `schedule|event`, `trigger_config` jsonb, `actions`
  jsonb array, dedup_key template), `automation_runs` (audit log)
  (`20260601100000_create_automations.sql`). Engine = `run-automations`.
- Workflow-instance tables back the older step-based `workflow-*` functions.

### Sponsors / deliverables / revenue
- `sponsors`, `sponsor_deliverables`, `sponsor_campaigns` ("Brands" in UI = campaign
  in DB), `campaign_briefs`, `sponsor_reads`, `ad_read_proposals`,
  `revenue_events` / `revenue_transactions`, `read_slot_limits`, `beat_sheets`.
- Locked down in `20260602100000_lock_sponsor_reads_revenue_txns.sql`.

### Freelancer portal
- `freelancer_profiles` (payment method, `tour_completed_at`, column-locked so
  freelancers can't edit rate fields), `freelancer_assignments`,
  `freelancer_documents` (`20260505000000_freelancer_studio.sql` +
  follow-ups). `freelancer_profiles` has an INSERT policy so a freelancer can
  create their own row during setup (`20260601120000_freelancer_profiles_insert_policy.sql`).
- **Hourly payroll (retainer + overtime), `20260724120000_hourly_payroll_retainer_overtime.sql`:**
  `freelancer_profiles` gained `retainer_enabled`/`retainer_min_hours`,
  `overtime_enabled`/`overtime_max_hours`/`overtime_multiplier` (admin-set on the
  Freelancers→Team edit form **and the invite form** — hourly-gated; the
  `fl_profile_lock_admin_fields` BEFORE-UPDATE trigger was extended to block
  contractors from self-editing these). **Invite flow
  (`20260724160000_invite_retainer_overtime.sql`):** the same 5 settings are flat
  columns on `invitations` (mirroring `payment_type`/`rate`); `invite-user` writes
  them, and the `fl_profile_set_payment_from_invitation` BEFORE-INSERT trigger was
  extended to hard-set them onto `freelancer_profiles` from the invitation at accept
  time (AuthPage/AuthPageMobile setup) — so the setup client cannot spoof them
  (defaults: disabled + 1.5x when the invitation didn't set them). Pay math is
  a **single source of truth**: `compute_freelancer_pay(freelancer, p_start, p_end)`
  (SECURITY DEFINER, self-or-admin gated, returns per-retainer-window JSON breakdown;
  the admin Hours tab + mobile HoursDetail render it). Each bi-weekly pay period
  splits into two **retainer weeks** (1–7, 8–15, 16–22, 23–EOM) via the pure helper
  `fl_retainer_window(date)`; retainer floor is guaranteed per week and the overtime
  cap resets per week; hours attributed by `completed_at` in **PT**
  (`(completed_at at time zone 'America/Los_Angeles')::date`). Overtime multiplier
  applies **only if approved**: `freelancer_overtime_approvals` (one row per
  freelancer+window). Trigger `fl_overtime_check_on_start` (AFTER UPDATE on
  `freelancer_assignments`, status→`in_progress`) opens an approval + `confirm_overtime`
  tasks for all admins + `director_creative` when accumulated window hours ≥ cap−5
  (fail-open: wrapped in EXCEPTION so it never blocks the status change). Completing
  any one of those tasks (via the normal `workflow-complete-task` path) fires
  `fl_overtime_task_completed` (AFTER UPDATE on `tasks`, guarded by
  `related_entity_type='overtime_approval'`) which flips the approval to `approved`
  and auto-clears the sibling tasks. Both trigger fns have EXECUTE revoked from
  public/anon/authenticated (trigger-only). **The FreelancerHours page (contractor)
  prefills the pay-period total from the PT-bucketed sum of assignment `hours_spent`,
  editable/overridable.** No mobile twin for FreelancerHours or the Team tab
  (FreelancersMobile has only Assignments+Hours tabs).

### Agency portal
- `agency_comments` (polymorphic: `entity_type` deliverable|proposal; BEFORE
  INSERT trigger forces `author_id = auth.uid()` and snapshots `author_role`).
- SECURITY DEFINER views `agency_deliverables` / `agency_briefs` expose a
  **trimmed** subset (no pay/notes/ad_copy/source_text).
- `is_agency(uid)` helper excludes agency accounts from staff-wide policies via
  `ALTER POLICY ... USING (NOT public.is_agency(auth.uid()))`
  (`20260709190000_agency_portal.sql`).

### Messaging & notifications
- `channels`, `channel_messages` (with `mentions` array), `channel_message` pins.
- `conversations`, `conversation_participants`, `direct_messages` (with
  `reply_to`, reactions). DMs don't create `notifications` rows (would flood the
  bell); mobile push comes from a `forward_dm_to_push` trigger.
- **Image attachments** (`20260723000000_message_attachments.sql`): nullable
  `attachments jsonb` on both `channel_messages` and `direct_messages` — array of
  `{ url, name, width?, height? }`. `content` is `text NOT NULL` (no CHECK), so
  attachment-only messages send `content: ''`. Uploads go to the public
  `message-attachments` bucket at `${uid}/${convoOrChannelId}/${ts}-${name}`
  (INSERT RLS `foldername[1]=auth.uid()::text`, mirroring `avatars`). Shared
  client modules: `src/lib/messageImages.js` (validate PNG/JPG + 10MB cap,
  client-side canvas **compression** to ~2048px longest edge, upload, preview
  URLs, `dragHasFiles`, storage cleanup), `src/lib/useAttachmentEdit.js` (edit
  add/remove), `src/components/MessageAttachments.js` (inline render + in-app
  lightbox), `src/components/AttachmentEditRow.js` — used by all four chat twins.
  **Delete cleanup:** edge fn `cleanup-message-attachments` (`--no-verify-jwt`,
  validates the caller JWT) deletes the row through a *caller-scoped* client so
  the table's own DELETE RLS authorizes (DM = owner; channel = owner or
  `is_channel_admin()`), then service-role-removes the storage objects — the only
  way to clean up when a channel admin deletes another user's image (client-side
  `storage.remove` would fail the per-user storage DELETE policy). Messages with
  no attachments still delete directly client-side.
- `notifications` — the bell system. `announcements` / `announcement_reads`.
- `get_notification_summary(p_user_id, p_role, p_dashboard_last_seen)` RPC
  returns all badge counts in one call. See `06-realtime-notifications.md`.

### Accounting (Tiller + Plaid)
- `revenue_transactions`, `expense_transactions` — extended with `source`
  (`tiller`/`plaid`), `review_status`, transfer flagging
  (`20260704180000_plaid_bank_feed.sql`).
- `plaid_items` (**access_token is service-role-only: RLS enabled with NO
  policies**), `linked_accounts`, `category_rules`, `account_balances`.
- Tiller history keeps working via column defaults
  (`source='tiller', review_status='confirmed'`). Plaid is the dormant fallback;
  app-side categorization is live (see `project_plaid_accounting` memory).

## RLS role model

Roles live in the `profiles.role` CHECK constraint:
`admin`, `assistant`, `member`, `partner`, `freelancer`, `director_creative`,
`director_comms`, `producer`, `agency`.

- **Admin tier at the DB layer**: `public.is_admin()` /
  `public.is_admin_or_assistant()` SECURITY DEFINER helpers. Admin-tier roles
  (`admin`, `director_creative`, `director_comms`) all pass `is_admin()`.
  Director restrictions are **UI-only** (`src/lib/rolePermissions.js`) — RLS
  does not block directors from the underlying tables; the nav hide + route
  guard is the enforcement boundary. See the header comment in `rolePermissions.js:1-14`.
- **Freelancer / agency** are genuinely fenced by RLS, not just UI. Agency is
  excluded from staff-wide policies via `is_agency()` and reads through trimmed
  DEFINER views.
- Adding a role means: (1) widen the `profiles.role` CHECK, (2) add it to
  `is_admin`/`is_admin_or_assistant` if admin-tier, (3) mirror in
  `ADMIN_TIER_ROLES`/`ROLE_RESTRICTED_NAV_KEYS` in `rolePermissions.js`.

## FK conventions & gotchas

- **`created_by` / `author_id` / `owner_id` → `public.profiles(id)`** is the
  modern convention (`ON DELETE SET NULL` or `CASCADE`). Older tables reference
  `auth.users(id)` directly — both exist in the codebase, so check the specific
  migration. This inconsistency is a known audit item (`audit_phase3_db` memory).
- `bd_*` initiatives/milestones reference their phase via `phase_id` with
  cascade delete.
- Service-role-only secrets (Plaid `access_token`) sit in RLS-enabled tables
  with **zero policies** — reachable only via the service-role key in edge
  functions.

## Migration workflow caveat

Local migration history has **diverged** from remote. Do **not** use
`supabase db push`. Apply schema changes via the Supabase MCP `apply_migration`
tool (or `list_migrations` to inspect). See `07-build-deploy-vercel.md` and the
`project_supabase_migration_divergence` memory.
