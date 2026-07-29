-- ============================================================================
-- CONTRACT: Freelancer -> Contractor rename — FINAL TIGHTENING
-- ============================================================================
-- !!! DO NOT APPLY until the NEW frontend (which reads both role values and
--     writes 'contractor') has been deployed to prod via Vercel AND verified.
--     The currently-deployed OLD frontend hard-checks role === 'freelancer' in
--     JS and reads the freelancer_* compat views; this migration removes both,
--     so applying it before cutover WILL break the live site.
--
-- Cutover order:
--   1. (done) EXPAND migration applied + edge fns deployed.
--   2. User: git commit + push  ->  Vercel deploys the new frontend.
--   3. User: verify contractor login, admin Contractors page, invites, hours.
--   4. Redeploy jobs-review with role 'contractor' (see step A below), then
--      apply THIS migration.
-- ============================================================================
--
-- Companion NON-SQL cutover steps (do around applying this migration):
--   A. Edit supabase/functions/jobs-review/index.ts: the two occurrences of
--      role: "freelancer" (approve-applicant path) -> "contractor", then
--      `supabase functions deploy jobs-review --no-verify-jwt`. This is the
--      last writer still emitting 'freelancer'; flip it so no new 'freelancer'
--      rows appear after the sweep below.
--   B. (optional cleanup, non-urgent) morty-assistant BLOCKED_ROLES and
--      drive-upload-init role allow-list still list BOTH 'contractor' and
--      'freelancer' (harmless superset). Drop 'freelancer' whenever convenient.
--   C. (optional cosmetic, deferred) FK/index constraint names still read
--      freelancer_* on the contractor_* base tables; the storage bucket is
--      still 'freelancer-documents'; the RPC/helper names are still
--      compute_freelancer_pay / is_freelancer / fl_*; policy names still say
--      "freelancer ...". All are functional as-is. Rename later if desired
--      (the bucket rename would require migrating stored object paths).
-- ============================================================================
-- (Applied via apply_migration -> single transaction. No BEGIN/COMMIT here.)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Sweep the role DATA to 'contractor' (must happen BEFORE tightening the
--    constraint/helpers, and while functions still accept both values).
-- ---------------------------------------------------------------------------
-- profiles.role is guarded by the BEFORE UPDATE trigger profiles_lock_admin_fields()
-- ("role is admin-only"), which fails when run with a null auth.uid() (as here).
-- Disable it only for this controlled sweep, then re-enable in the same
-- transaction (a mid-migration failure rolls back the whole thing, so the guard
-- is never left disabled).
ALTER TABLE public.profiles DISABLE TRIGGER profiles_lock_admin_fields;
UPDATE public.profiles    SET role = 'contractor' WHERE role = 'freelancer';
ALTER TABLE public.profiles ENABLE TRIGGER profiles_lock_admin_fields;
UPDATE public.invitations SET role = 'contractor' WHERE role = 'freelancer' AND accepted_at IS NULL;
-- Optional (rolesAllow() already treats the two as equivalent, so not required):
--   channel allowed_roles arrays created before cutover may still contain
--   'freelancer'. Normalize if you later drop the equivalence shim in Channels.js.

-- ---------------------------------------------------------------------------
-- 2. Drop the backward-compat VIEWS (old prod frontend is gone).
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.freelancer_assignment_comments;
DROP VIEW IF EXISTS public.freelancer_assignments;
DROP VIEW IF EXISTS public.freelancer_documents;
DROP VIEW IF EXISTS public.freelancer_hours;
DROP VIEW IF EXISTS public.freelancer_overtime_approvals;
DROP VIEW IF EXISTS public.freelancer_profiles;

-- ---------------------------------------------------------------------------
-- 3. Tighten the role helper to 'contractor' only. This single change also
--    tightens every RLS policy that routes through is_freelancer(), including
--    the "Freelancers upload signed docs" storage policy.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_freelancer(uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (select 1 from profiles where id = uid and role = 'contractor');
$function$;

-- ---------------------------------------------------------------------------
-- 4. Tighten get_notification_summary to 'contractor' only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_notification_summary(p_user_id uuid, p_role text, p_dashboard_last_seen timestamp with time zone DEFAULT '1970-01-01 00:00:00+00'::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  result jsonb;
  v_today date := (now() at time zone 'America/Los_Angeles')::date;
  v_announcement_count int := 0; v_notification_count int := 0; v_proposal_count int := 0;
  v_unsigned_doc_count int := 0; v_stuck_comment_count int := 0; v_fl_comment_count int := 0;
  v_task_count int := 0; v_assignment_count int := 0;
begin
  p_user_id := auth.uid();
  if p_user_id is null then
    return jsonb_build_object('unread_announcement_count',0,'unread_notification_count',0,'pending_proposal_count',0,'unsigned_doc_count',0,'stuck_comment_count',0,'fl_comment_count',0,'my_task_count',0,'new_assignment_count',0,'agency_unresolved_count',0);
  end if;
  select role into p_role from public.profiles where id = p_user_id;
  select count(*) into v_announcement_count from announcements a
    where a.target_date = v_today and not exists (select 1 from announcement_reads ar where ar.announcement_id = a.id and ar.user_id = p_user_id);
  select count(*) into v_notification_count from notifications where user_id = p_user_id and is_read = false;
  select count(*) into v_proposal_count from ad_read_proposals where status = 'pending';
  if p_role = 'contractor' then
    select count(*) into v_unsigned_doc_count from contractor_documents where contractor_id = p_user_id and doc_type = 'signing' and signed_at is null;
  end if;
  if p_role = 'admin' then
    select count(*) into v_stuck_comment_count from notifications where user_id = p_user_id and type = 'fl_stuck' and is_read = false;
    select count(*) into v_fl_comment_count from notifications where user_id = p_user_id and type = 'fl_comment' and is_read = false;
  end if;
  select count(*) into v_task_count from tasks
    where assignee_id = p_user_id
      and status in ('pending','active','on_hold')
      and (snoozed_until is null or snoozed_until < now())
      and coalesce(count_in_badge, true) = true;
  if p_role = 'contractor' then
    select count(*) into v_assignment_count from contractor_assignments where contractor_id = p_user_id and status = 'assigned';
  end if;
  result := jsonb_build_object('unread_announcement_count',v_announcement_count,'unread_notification_count',v_notification_count,'pending_proposal_count',v_proposal_count,'unsigned_doc_count',v_unsigned_doc_count,'stuck_comment_count',v_stuck_comment_count,'fl_comment_count',v_fl_comment_count,'my_task_count',v_task_count,'new_assignment_count',v_assignment_count,'agency_unresolved_count',0);
  return result;
end; $function$;

-- ---------------------------------------------------------------------------
-- 5. Tighten the projects staff-write policies: drop 'freelancer'.
-- ---------------------------------------------------------------------------
ALTER POLICY "Staff can create projects" ON public.projects
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid()
      AND (p.role <> ALL (ARRAY['contractor','agency','partner']))));

ALTER POLICY "Staff can update projects" ON public.projects
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid()
      AND (p.role <> ALL (ARRAY['contractor','agency','partner']))))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid()
      AND (p.role <> ALL (ARRAY['contractor','agency','partner']))));

-- ---------------------------------------------------------------------------
-- 6. Tighten the profiles role CHECK constraint: remove 'freelancer'.
--    (Safe only because step 1 swept all 'freelancer' rows.)
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles DROP CONSTRAINT profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK (
  role = ANY (ARRAY['admin','assistant','member','partner','contractor',
                    'director_creative','director_comms','producer'])
);

NOTIFY pgrst, 'reload schema';
