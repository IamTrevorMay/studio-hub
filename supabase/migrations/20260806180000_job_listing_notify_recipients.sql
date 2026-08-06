-- Per-listing notification recipients for new job applications.
--
--   job_listings.notify_user_ids — admin-tier users who get the in-app alert
--     when someone applies to this listing. Empty array = fall back to every
--     admin, which is what jobs-apply did unconditionally before this.
--
-- Also adds new_application_count to get_notification_summary so the Jobs
-- sidebar tab can carry a numbered badge.

ALTER TABLE public.job_listings
  ADD COLUMN IF NOT EXISTS notify_user_ids uuid[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.job_listings.notify_user_ids IS
  'Admin-tier profile ids notified on a new application. Empty = all admins.';

-- Unread job_application notifications are looked up per user on every badge
-- refresh; index the predicate that query filters on.
CREATE INDEX IF NOT EXISTS notifications_job_application_unread_idx
  ON public.notifications (user_id)
  WHERE type = 'job_application' AND is_read = false;

-- get_notification_summary: live body (20260730140000) + new_application_count.
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
  v_task_count int := 0; v_assignment_count int := 0; v_new_application_count int := 0;
begin
  p_user_id := auth.uid();
  if p_user_id is null then
    return jsonb_build_object('unread_announcement_count',0,'unread_notification_count',0,'pending_proposal_count',0,'unsigned_doc_count',0,'stuck_comment_count',0,'fl_comment_count',0,'my_task_count',0,'new_assignment_count',0,'agency_unresolved_count',0,'new_application_count',0);
  end if;
  select role into p_role from public.profiles where id = p_user_id;
  select count(*) into v_announcement_count from announcements a
    where a.target_date = v_today and not exists (select 1 from announcement_reads ar where ar.announcement_id = a.id and ar.user_id = p_user_id);
  select count(*) into v_notification_count from notifications where user_id = p_user_id and is_read = false;
  select count(*) into v_proposal_count from ad_read_proposals where status = 'pending';
  if p_role in ('freelancer','contractor') then
    select count(*) into v_unsigned_doc_count from contractor_documents where contractor_id = p_user_id and doc_type = 'signing' and signed_at is null;
  end if;
  if p_role = 'client' then
    select count(*) into v_unsigned_doc_count from client_documents where client_id = p_user_id and doc_type = 'signing' and signed_at is null;
  end if;
  if p_role = 'admin' then
    select count(*) into v_stuck_comment_count from notifications where user_id = p_user_id and type = 'fl_stuck' and is_read = false;
    select count(*) into v_fl_comment_count from notifications where user_id = p_user_id and type = 'fl_comment' and is_read = false;
  end if;
  -- Jobs is admin-tier only, so directors need this too (not just p_role='admin').
  if p_role in ('admin','director','director_creative','director_comms') then
    select count(*) into v_new_application_count from notifications
      where user_id = p_user_id and type = 'job_application' and is_read = false;
  end if;
  select count(*) into v_task_count from tasks
    where assignee_id = p_user_id
      and status in ('pending','active','on_hold')
      and (snoozed_until is null or snoozed_until < now())
      and coalesce(count_in_badge, true) = true;
  if p_role in ('freelancer','contractor') then
    select count(*) into v_assignment_count from contractor_assignments where contractor_id = p_user_id and status = 'assigned';
  end if;
  result := jsonb_build_object('unread_announcement_count',v_announcement_count,'unread_notification_count',v_notification_count,'pending_proposal_count',v_proposal_count,'unsigned_doc_count',v_unsigned_doc_count,'stuck_comment_count',v_stuck_comment_count,'fl_comment_count',v_fl_comment_count,'my_task_count',v_task_count,'new_assignment_count',v_assignment_count,'agency_unresolved_count',0,'new_application_count',v_new_application_count);
  return result;
end; $function$;

notify pgrst, 'reload schema';
