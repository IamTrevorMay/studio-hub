-- MEDIUM fixes: SECURITY DEFINER RPCs that trust client input or are anon-callable.

-- 1. get_notification_summary trusted client-supplied p_user_id/p_role, so any
--    caller could pass a victim's uuid + p_role='admin' to read their counts and
--    unlock admin-only branches (IDOR + role spoof). Derive both from auth.uid()
--    instead; the client still passes the args (harmless, ignored). Also bucket
--    "today's announcements" on the PT calendar day, not UTC.
create or replace function public.get_notification_summary(
  p_user_id uuid,
  p_role text,
  p_dashboard_last_seen timestamp with time zone default '1970-01-01 00:00:00+00'::timestamptz
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  result jsonb;
  v_today date := (now() at time zone 'America/Los_Angeles')::date;
  v_announcement_count int := 0;
  v_notification_count int := 0;
  v_proposal_count int := 0;
  v_unsigned_doc_count int := 0;
  v_stuck_comment_count int := 0;
  v_fl_comment_count int := 0;
  v_task_count int := 0;
  v_assignment_count int := 0;
begin
  -- Ignore client-supplied identity/role; derive from the authenticated caller.
  p_user_id := auth.uid();
  if p_user_id is null then
    return jsonb_build_object(
      'unread_announcement_count', 0, 'unread_notification_count', 0,
      'pending_proposal_count', 0, 'unsigned_doc_count', 0,
      'stuck_comment_count', 0, 'fl_comment_count', 0,
      'my_task_count', 0, 'new_assignment_count', 0);
  end if;
  select role into p_role from public.profiles where id = p_user_id;

  select count(*) into v_announcement_count
  from announcements a
  where a.target_date = v_today
    and not exists (
      select 1 from announcement_reads ar
      where ar.announcement_id = a.id and ar.user_id = p_user_id
    );

  select count(*) into v_notification_count
  from notifications
  where user_id = p_user_id and is_read = false;

  select count(*) into v_proposal_count
  from ad_read_proposals
  where status = 'pending';

  if p_role = 'freelancer' then
    select count(*) into v_unsigned_doc_count
    from freelancer_documents
    where freelancer_id = p_user_id
      and doc_type = 'signing'
      and signed_at is null;
  end if;

  if p_role = 'admin' then
    select count(*) into v_stuck_comment_count
    from notifications
    where user_id = p_user_id and type = 'fl_stuck' and is_read = false;

    select count(*) into v_fl_comment_count
    from notifications
    where user_id = p_user_id and type = 'fl_comment' and is_read = false;
  end if;

  select count(*) into v_task_count
  from tasks
  where assignee_id = p_user_id
    and status in ('pending', 'active', 'on_hold')
    and (snoozed_until is null or snoozed_until < now());

  if p_role = 'freelancer' then
    select count(*) into v_assignment_count
    from freelancer_assignments
    where freelancer_id = p_user_id and status = 'assigned';
  end if;

  result := jsonb_build_object(
    'unread_announcement_count', v_announcement_count,
    'unread_notification_count', v_notification_count,
    'pending_proposal_count', v_proposal_count,
    'unsigned_doc_count', v_unsigned_doc_count,
    'stuck_comment_count', v_stuck_comment_count,
    'fl_comment_count', v_fl_comment_count,
    'my_task_count', v_task_count,
    'new_assignment_count', v_assignment_count
  );
  return result;
end;
$function$;

-- 2. get_sync_health is SECURITY DEFINER (bypasses RLS on platform_accounts) with
--    no auth check and default PUBLIC execute, leaking every account's
--    last_error_message / token_status to anon. Gate to admins (empty set for
--    non-admins, so the analytics widgets degrade gracefully) and revoke anon.
create or replace function public.get_sync_health()
returns table(platform_account_id uuid, platform text, account_name text, last_synced_at timestamptz, last_success_at timestamptz, last_error_at timestamptz, last_error_message text, consecutive_failures integer, token_status text, hours_since_success double precision, yesterday_row_count bigint, expected_row_count bigint, stale boolean, stale_reason text)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    return;  -- non-admins get no rows
  end if;
  return query
  select
    pa.id,
    pa.platform,
    pa.account_name,
    pa.last_synced_at,
    pa.last_success_at,
    pa.last_error_at,
    pa.last_error_message,
    pa.consecutive_failures,
    pa.token_status,
    extract(epoch from (now() - pa.last_success_at)) / 3600.0,
    coalesce(pdm.cnt, 0),
    1::bigint,
    coalesce(flat.is_stale, false),
    case when coalesce(flat.is_stale, false)
         then 'Views identical for 3+ days — likely cached/stale API data'
         else null end
  from platform_accounts pa
  left join (
    select platform_account_id, count(*) as cnt
    from platform_daily_metrics
    where date = (current_date - interval '1 day')::date
    group by platform_account_id
  ) pdm on pdm.platform_account_id = pa.id
  left join lateral (
    select (count(*) = 3 and count(distinct views) = 1 and min(views) > 0) as is_stale
    from (
      select views
      from platform_daily_metrics
      where platform_account_id = pa.id
        and date between (current_date - interval '3 day')::date and (current_date - interval '1 day')::date
        and views is not null
      order by date desc
      limit 3
    ) recent
  ) flat on true
  where pa.is_active = true
  order by pa.platform, pa.account_name;
end;
$function$;

revoke execute on function public.get_sync_health() from anon;
revoke execute on function public.get_notification_summary(uuid, text, timestamptz) from anon;

-- 3. create_group_conversation inserted arbitrary participant ids (RLS-bypassing)
--    with no validation, letting any user force-add victims to a group. Validate
--    that every participant is a real profile and cap the count.
create or replace function public.create_group_conversation(
  p_participant_ids uuid[],
  p_name text default null::text
) returns conversations
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  creator uuid := auth.uid();
  conv public.conversations;
  v_valid int;
  v_requested int;
begin
  if creator is null then
    raise exception 'Not authenticated';
  end if;
  if p_participant_ids is null or array_length(p_participant_ids, 1) is null then
    raise exception 'At least one other participant is required';
  end if;
  if array_length(p_participant_ids, 1) > 50 then
    raise exception 'Too many participants';
  end if;

  -- Every requested participant must be an existing profile (no forced-add of
  -- arbitrary/garbage ids). Compare distinct requested (excluding the creator).
  select count(distinct uid) into v_requested
  from unnest(p_participant_ids) uid
  where uid <> creator;

  select count(*) into v_valid
  from public.profiles pr
  where pr.id in (select distinct unnest(p_participant_ids)) and pr.id <> creator;

  if v_valid < v_requested then
    raise exception 'One or more participants are not valid users';
  end if;

  insert into public.conversations (name, is_group, created_by)
  values (
    nullif(btrim(coalesce(p_name, '')), ''),
    array_length(p_participant_ids, 1) > 1,
    creator
  )
  returning * into conv;

  insert into public.conversation_participants (conversation_id, user_id)
  select conv.id, uid
  from (select distinct unnest(array_append(p_participant_ids, creator)) as uid) s;

  return conv;
end;
$function$;
