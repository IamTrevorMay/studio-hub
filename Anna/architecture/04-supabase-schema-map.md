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

### Business Dev (`bd_*`) — see `CLAUDE.md` for the full spec
- `bd_phases`, `bd_initiatives`, `bd_initiative_links`, `bd_tasks`,
  `bd_milestones`, `bd_settings`
  (`20260503000000_create_business_dev.sql`, `..._phases.sql`).
- **admin-only RLS** on all `bd_*`. Separate world from the Goals page's
  `initiatives` table. Also readable by `partner` (Roadmap portal).
- `bd_initiatives.workstream` CHECK allows `'inbox'` in addition to the 7 real
  workstreams (`20260723090000_bd_inbox_workstream.sql`) — quick-capture bucket
  for the Roadmap quick-add; triaged via the initiative edit form. Timeline
  view deliberately skips `inbox` items (it maps only the 7 real workstreams).
- Shared client helpers live in `src/lib/bdAttention.js` (tag/status metadata,
  PT-correct "Needs Attention" buckets, and `syncBdTaskToBacklog` — the
  `personal_tasks` mirror both `BusinessDev.js` and `BusinessDevMobile.js`
  must call after any `bd_tasks` write touching completed_at/due_date/owner).
- Overdue-task notifications via cron
  (`20260503000001_cron_business_dev_notifications.sql`).

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
