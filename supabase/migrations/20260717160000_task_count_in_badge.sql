-- Per-task opt-out of the My Tasks tab notification badge. When a user unchecks
-- the box on a task card, count_in_badge flips to false and the task stops
-- contributing to my_task_count (the number on the Dashboard/My Tasks tab).
-- The task itself still appears in My Tasks — only the badge count is affected.

alter table public.tasks
  add column if not exists count_in_badge boolean not null default true;

-- Re-create the notification summary RPC with the task count excluding
-- badge-hidden tasks. Only the v_task_count query changes vs. the prior version.
create or replace function public.get_notification_summary(
  p_user_id uuid,
  p_role text,
  p_dashboard_last_seen timestamp with time zone default '1970-01-01 00:00:00+00'::timestamptz
)
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
  v_task_count int := 0; v_assignment_count int := 0; v_agency_unresolved int := 0;
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
  if p_role = 'freelancer' then
    select count(*) into v_unsigned_doc_count from freelancer_documents where freelancer_id = p_user_id and doc_type = 'signing' and signed_at is null;
  end if;
  if p_role = 'admin' then
    select count(*) into v_stuck_comment_count from notifications where user_id = p_user_id and type = 'fl_stuck' and is_read = false;
    select count(*) into v_fl_comment_count from notifications where user_id = p_user_id and type = 'fl_comment' and is_read = false;
  end if;
  if p_role in ('admin', 'director_creative', 'director_comms') then
    -- Threads whose latest comment is from the agency (entity must still exist)
    select count(*) into v_agency_unresolved from (
      select distinct on (c.entity_type, c.entity_id) c.entity_type, c.entity_id, c.author_role
      from agency_comments c
      order by c.entity_type, c.entity_id, c.created_at desc
    ) t
    where t.author_role = 'agency'
      and (
        (t.entity_type = 'deliverable' and exists (select 1 from sponsor_deliverables d where d.id = t.entity_id))
        or (t.entity_type = 'proposal' and exists (select 1 from ad_read_proposals pr where pr.id = t.entity_id))
      );
    -- Pending agency proposals nobody has replied to yet
    select v_agency_unresolved + count(*) into v_agency_unresolved
    from ad_read_proposals pr
    where pr.status = 'pending'
      and exists (select 1 from profiles p where p.id = pr.created_by and p.role = 'agency')
      and not exists (select 1 from agency_comments c where c.entity_type = 'proposal' and c.entity_id = pr.id);
  end if;
  select count(*) into v_task_count from tasks
    where assignee_id = p_user_id
      and status in ('pending','active','on_hold')
      and (snoozed_until is null or snoozed_until < now())
      and coalesce(count_in_badge, true) = true;
  if p_role = 'freelancer' then
    select count(*) into v_assignment_count from freelancer_assignments where freelancer_id = p_user_id and status = 'assigned';
  end if;
  result := jsonb_build_object('unread_announcement_count',v_announcement_count,'unread_notification_count',v_notification_count,'pending_proposal_count',v_proposal_count,'unsigned_doc_count',v_unsigned_doc_count,'stuck_comment_count',v_stuck_comment_count,'fl_comment_count',v_fl_comment_count,'my_task_count',v_task_count,'new_assignment_count',v_assignment_count,'agency_unresolved_count',v_agency_unresolved);
  return result;
end; $function$;
