-- ============================================================================
-- Security remediation — privilege escalation + RLS hardening
-- Drafted by Anna, 2026-07-15. DRAFT FOR REVIEW.
--
-- Apply via the Supabase MCP `apply_migration` (NOT `supabase db push` — the
-- migration history has diverged from remote). After applying, re-run
-- get_advisors(security) to confirm the findings clear, and TEST a real invite
-- acceptance + a normal profile edit before considering this done.
--
-- Covers (approved scope, non-breaking):
--   C1a  profiles self-promotion to admin (CRITICAL)
--   C1b  handle_new_user trusts client role metadata + unpinned search_path (CRITICAL)
--   C2   tiller_category_snapshot RLS off + anon CRUD on financial data (CRITICAL)
--   H2   projects / platform_daily_metrics writable by any authenticated user (HIGH)
--
-- Deliberately EXCLUDED (would break production — handled separately):
--   C3   anon CRUD on cut_records/sessions/autocut_models/cockpit_*/presets —
--        those are written by external local tools (Premiere autocut / cockpit)
--        using the anon key; a blind DROP breaks ingestion. Needs a secret-gated
--        edge-function ingestion path (or the usage-study `sessions` teardown)
--        decided first.
--   H3   notifications INSERT WITH CHECK true — the app inserts CROSS-USER
--        notifications from the client in ~10 places (task assignment notifies the
--        assignee, whose user_id != auth.uid()). Locking this by RLS breaks those
--        flows; the real fix is to move notification creation server-side.
-- ============================================================================


-- ============================================================================
-- C1a. profiles: block non-admins from escalating their own role / posting rights
-- ----------------------------------------------------------------------------
-- The live "Users can update their own profile" policy is UPDATE to
-- {authenticated} USING (auth.uid() = id) with NO WITH CHECK, and there is no
-- guard trigger. So any logged-in user can run:
--     update profiles set role = 'admin' where id = auth.uid();
-- and instantly gain admin-tier access. A WITH CHECK can't pin per-column
-- immutability cleanly, so enforce it with a BEFORE UPDATE trigger. The
-- self-update policy is left in place (users still edit their own name, avatar,
-- payment info, etc.) — the trigger just freezes the privileged columns.
-- ============================================================================
create or replace function public.protect_profile_privileged_cols()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Service role (auth.uid() is null) and admins may change anything.
  if auth.uid() is null or public.is_admin(auth.uid()) then
    return new;
  end if;
  -- Non-admins editing their own row cannot change privileged columns.
  new.role := old.role;
  new.posting_allowed := old.posting_allowed;
  return new;
end;
$$;

drop trigger if exists profiles_protect_privileged on public.profiles;
create trigger profiles_protect_privileged
  before update on public.profiles
  for each row
  execute function public.protect_profile_privileged_cols();


-- ============================================================================
-- C1b. handle_new_user: derive role from the server-side invitations table,
--      never from client-controlled signup metadata; pin search_path.
-- ----------------------------------------------------------------------------
-- The current function sets role = COALESCE(raw_user_meta_data->>'role','member').
-- raw_user_meta_data is client-supplied at signUp(), so a self-registering user
-- can pass role:'admin' and be born admin. It is also SECURITY DEFINER with no
-- pinned search_path (advisor: function_search_path_mutable).
--
-- Fix: look up the invited role by email in public.invitations (how invited users
-- are provisioned) and ignore any client-supplied role. Un-invited signups → 'member'.
-- Body is otherwise identical to the live definition (verified via pg_get_functiondef).
-- ⚠ REVIEW CLOSELY + test a real invite acceptance before prod — this runs on every signup.
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  invited_role text;
begin
  select i.role
    into invited_role
  from public.invitations i
  where lower(i.email) = lower(NEW.email)
    and i.role is not null
  order by i.created_at desc
  limit 1;

  insert into public.profiles (
    id, full_name, nickname, email, role, title,
    assigned_drive_folder_id, assigned_drive_folder_name
  )
  values (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'nickname', ''),
    NEW.email,
    COALESCE(invited_role, 'member'),   -- server-derived; NOT from client metadata
    NULLIF(NEW.raw_user_meta_data->>'title', ''),
    NULLIF(NEW.raw_user_meta_data->>'assigned_drive_folder_id', ''),
    NULLIF(NEW.raw_user_meta_data->>'assigned_drive_folder_name', '')
  )
  on conflict (id) do update
    set email    = EXCLUDED.email,
        nickname = COALESCE(EXCLUDED.nickname, public.profiles.nickname),
        title    = COALESCE(EXCLUDED.title, public.profiles.title),
        assigned_drive_folder_id   = COALESCE(EXCLUDED.assigned_drive_folder_id, public.profiles.assigned_drive_folder_id),
        assigned_drive_folder_name = COALESCE(EXCLUDED.assigned_drive_folder_name, public.profiles.assigned_drive_folder_name);
  return NEW;
end;
$$;


-- ============================================================================
-- C2. tiller_category_snapshot: enable RLS, revoke anon/authenticated
-- ----------------------------------------------------------------------------
-- RLS was OFF and anon held full CRUD (incl. TRUNCATE) on ~1,423 rows of
-- financial category data — readable/writable with the public anon key, no login.
-- Only edge functions (service role, which bypasses RLS + grants) touch this
-- table; no client code reads it (verified: grep of src/ is empty). Lock it fully.
-- ============================================================================
alter table public.tiller_category_snapshot enable row level security;
revoke all on public.tiller_category_snapshot from anon, authenticated;
-- No policy added on purpose: service role bypasses RLS. If a UI ever needs to
-- read this, add an admin-only SELECT policy + a matching GRANT then.


-- ============================================================================
-- H2a. projects: replace UPDATE/INSERT USING(true) with a staff-only predicate
-- ----------------------------------------------------------------------------
-- "Authenticated users can update projects" was UPDATE {authenticated} USING(true),
-- so any freelancer or agency account could overwrite any project. Client project
-- writes come only from the staff board (UnifiedBoard.js, Projects.js); agency is
-- read-only and freelancers use the fl_* pages, so scoping writes to staff roles
-- (everyone except freelancer/agency/partner) is behavior-preserving for staff.
-- INSERT was likewise WITH CHECK(true); same treatment.
-- ============================================================================
drop policy if exists "Authenticated users can update projects" on public.projects;
create policy "Staff can update projects" on public.projects
  for update to authenticated
  using (
    exists (select 1 from public.profiles p
             where p.id = auth.uid()
               and p.role not in ('freelancer','agency','partner'))
  )
  with check (
    exists (select 1 from public.profiles p
             where p.id = auth.uid()
               and p.role not in ('freelancer','agency','partner'))
  );

drop policy if exists "Authenticated users can create projects" on public.projects;
create policy "Staff can create projects" on public.projects
  for insert to authenticated
  with check (
    exists (select 1 from public.profiles p
             where p.id = auth.uid()
               and p.role not in ('freelancer','agency','partner'))
  );


-- ============================================================================
-- H2b. platform_daily_metrics: restrict writes to admins (service role syncs it)
-- ----------------------------------------------------------------------------
-- INSERT/UPDATE/DELETE were all {authenticated} true, letting any logged-in user
-- rewrite or zero analytics rows. These rows are written by the sync-* edge
-- functions under the service role (bypasses RLS), so no client needs write
-- access. SELECT is left open to authenticated (staff view analytics).
-- ============================================================================
drop policy if exists "Authenticated users can insert platform_daily_metrics" on public.platform_daily_metrics;
drop policy if exists "Authenticated users can update platform_daily_metrics" on public.platform_daily_metrics;
drop policy if exists "Authenticated users can delete platform_daily_metrics" on public.platform_daily_metrics;
create policy "Admins write platform_daily_metrics" on public.platform_daily_metrics
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));
-- Existing "Authenticated users can read platform_daily_metrics" (SELECT) stays.
