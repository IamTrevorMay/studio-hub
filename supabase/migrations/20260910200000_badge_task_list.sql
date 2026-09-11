-- Returns the tasks behind the Dashboard nav badge's my_task_count, using the
-- exact same filters as get_notification_summary, so the hover list always
-- matches the number.

create or replace function public.get_badge_task_list()
returns jsonb
language sql
security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id,
    'title', t.title,
    'status', t.status,
    'due_date', t.due_date
  ) order by t.created_at desc), '[]'::jsonb)
  from tasks t
  where t.assignee_id = auth.uid()
    and t.status in ('pending','active','on_hold')
    and (t.snoozed_until is null or t.snoozed_until < now())
    and coalesce(t.count_in_badge, true) = true
    and not exists (
      select 1 from personal_tasks pt
      where pt.task_id = t.id
        and pt.created_by = auth.uid()
        and pt.status in ('inbox','backlog')
    );
$$;

grant execute on function public.get_badge_task_list() to authenticated;
