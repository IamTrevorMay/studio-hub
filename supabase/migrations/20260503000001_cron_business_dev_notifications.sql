-- Daily cron: scan bd_tasks and bd_initiatives for overdue/due-today items
-- and insert notifications for their owners. Skips if a same-day notification
-- of the same type for the same target already exists (de-dupe).
-- Runs 7am PT (15:00 UTC).

create extension if not exists pg_cron with schema pg_catalog;

create or replace function public.bd_emit_due_notifications()
returns void
language plpgsql
security definer
as $$
declare
  today date := current_date;
begin
  -- Tasks: overdue
  insert into public.notifications (user_id, type, title, body, link_tab, link_target)
  select
    t.owner_id,
    'bd_task_overdue',
    'Overdue: ' || t.title,
    'Was due ' || to_char(t.due_date, 'Mon DD'),
    'business_dev',
    t.id::text
  from bd_tasks t
  where t.completed_at is null
    and t.owner_id is not null
    and t.due_date is not null
    and t.due_date < today
    and not exists (
      select 1 from public.notifications n
      where n.user_id = t.owner_id
        and n.type = 'bd_task_overdue'
        and n.link_target = t.id::text
        and n.created_at >= today::timestamptz
    );

  -- Tasks: due today
  insert into public.notifications (user_id, type, title, body, link_tab, link_target)
  select
    t.owner_id,
    'bd_task_due',
    'Due today: ' || t.title,
    'Business Dev task',
    'business_dev',
    t.id::text
  from bd_tasks t
  where t.completed_at is null
    and t.owner_id is not null
    and t.due_date = today
    and not exists (
      select 1 from public.notifications n
      where n.user_id = t.owner_id
        and n.type = 'bd_task_due'
        and n.link_target = t.id::text
        and n.created_at >= today::timestamptz
    );

  -- Initiatives: overdue (target_date in past, not done)
  insert into public.notifications (user_id, type, title, body, link_tab, link_target)
  select
    i.owner_id,
    'bd_initiative_overdue',
    'Initiative overdue: ' || i.title,
    'Target was ' || to_char(i.target_date, 'Mon DD'),
    'business_dev',
    i.id::text
  from bd_initiatives i
  where i.status <> 'done'
    and i.owner_id is not null
    and i.target_date is not null
    and i.target_date < today
    and not exists (
      select 1 from public.notifications n
      where n.user_id = i.owner_id
        and n.type = 'bd_initiative_overdue'
        and n.link_target = i.id::text
        and n.created_at >= today::timestamptz
    );
end;
$$;

-- Schedule daily at 15:00 UTC (7am PT, 8am PDT)
select cron.schedule(
  'daily-bd-due-notifications',
  '0 15 * * *',
  $$select public.bd_emit_due_notifications();$$
);
