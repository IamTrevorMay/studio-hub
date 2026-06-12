-- Single RPC that returns all notification badge counts in one call
-- Replaces 9 separate client-side queries
create or replace function public.get_notification_summary(
  p_user_id uuid,
  p_role text,
  p_dashboard_last_seen timestamptz default '1970-01-01T00:00:00Z'
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  result jsonb;
  v_today date := (now() at time zone 'UTC')::date;
  v_announcement_count int := 0;
  v_itinerary_count int := 0;
  v_notification_count int := 0;
  v_proposal_count int := 0;
  v_unsigned_doc_count int := 0;
  v_stuck_comment_count int := 0;
  v_task_count int := 0;
  v_assignment_count int := 0;
begin
  -- Unread announcements: today's announcements not yet read by user
  select count(*) into v_announcement_count
  from announcements a
  where a.target_date = v_today
    and not exists (
      select 1 from announcement_reads ar
      where ar.announcement_id = a.id and ar.user_id = p_user_id
    );

  -- New itinerary items (admin only): today's items updated after last seen
  if p_role = 'admin' then
    select count(*) into v_itinerary_count
    from daily_itinerary
    where target_date = v_today
      and updated_at > p_dashboard_last_seen;
  end if;

  -- Unread notifications
  select count(*) into v_notification_count
  from notifications
  where user_id = p_user_id and is_read = false;

  -- Pending proposals (all roles can see)
  select count(*) into v_proposal_count
  from ad_read_proposals
  where status = 'pending';

  -- Unsigned documents (freelancer only)
  if p_role = 'freelancer' then
    select count(*) into v_unsigned_doc_count
    from freelancer_documents
    where freelancer_id = p_user_id
      and doc_type = 'signing'
      and signed_at is null;
  end if;

  -- Stuck comments (admin only): fl_stuck notifications unread
  if p_role = 'admin' then
    select count(*) into v_stuck_comment_count
    from notifications
    where user_id = p_user_id
      and type = 'fl_stuck'
      and is_read = false;
  end if;

  -- My active tasks
  select count(*) into v_task_count
  from tasks
  where assignee_id = p_user_id
    and status in ('pending', 'active', 'on_hold')
    and (snoozed_until is null or snoozed_until < now());

  -- New assignments (freelancer only)
  if p_role = 'freelancer' then
    select count(*) into v_assignment_count
    from freelancer_assignments
    where freelancer_id = p_user_id
      and status = 'assigned';
  end if;

  result := jsonb_build_object(
    'unread_announcement_count', v_announcement_count,
    'new_itinerary_count', v_itinerary_count,
    'unread_notification_count', v_notification_count,
    'pending_proposal_count', v_proposal_count,
    'unsigned_doc_count', v_unsigned_doc_count,
    'stuck_comment_count', v_stuck_comment_count,
    'my_task_count', v_task_count,
    'new_assignment_count', v_assignment_count
  );

  return result;
end;
$$;
