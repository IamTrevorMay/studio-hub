-- Dashboard badge: my_task_count now ignores tasks whose sprint card
-- (personal_tasks via task_id) is sitting in Inbox or Backlog — only
-- cards planned into a sprint (ready/in_progress/holding) count.

create or replace function public.get_notification_summary(p_user_id uuid, p_role text, p_dashboard_last_seen timestamp with time zone default '1970-01-01 00:00:00+00'::timestamptz)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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
  select count(*) into v_task_count from tasks t
    where t.assignee_id = p_user_id
      and t.status in ('pending','active','on_hold')
      and (t.snoozed_until is null or t.snoozed_until < now())
      and coalesce(t.count_in_badge, true) = true
      and not exists (
        select 1 from personal_tasks pt
        where pt.task_id = t.id
          and pt.created_by = p_user_id
          and pt.status in ('inbox','backlog')
      );
  if p_role in ('freelancer','contractor') then
    select count(*) into v_assignment_count from contractor_assignments where contractor_id = p_user_id and status = 'assigned';
  end if;
  result := jsonb_build_object('unread_announcement_count',v_announcement_count,'unread_notification_count',v_notification_count,'pending_proposal_count',v_proposal_count,'unsigned_doc_count',v_unsigned_doc_count,'stuck_comment_count',v_stuck_comment_count,'fl_comment_count',v_fl_comment_count,'my_task_count',v_task_count,'new_assignment_count',v_assignment_count,'agency_unresolved_count',0,'new_application_count',v_new_application_count);
  return result;
end; $function$;
