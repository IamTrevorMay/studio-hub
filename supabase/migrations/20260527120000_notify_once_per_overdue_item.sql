-- Notify once per overdue / due-today item, not once per day.
--
-- Both bd_emit_due_notifications and fl_emit_due_notifications previously
-- de-duped per-day, so an item overdue for N days produced N notifications.
-- Switch to "no prior notification of this type for this target ever" so each
-- item nags exactly once until it is completed or deleted — the cleanup
-- triggers from 20260525120000 handle removal on completion/deletion.

create or replace function public.bd_emit_due_notifications()
returns void
language plpgsql
security definer
as $$
declare
  today date := current_date;
begin
  -- Tasks: overdue (one notification per task, ever)
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
    );

  -- Tasks: due today (one notification per task, ever)
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
    );

  -- Initiatives: overdue (one notification per initiative, ever)
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
    );
end;
$$;

create or replace function public.fl_emit_due_notifications()
returns void
language plpgsql
security definer
as $$
declare
  r record;
begin
  -- Overdue assignments
  for r in
    select id, freelancer_id, title
    from public.freelancer_assignments
    where status <> 'completed'
      and due_date < current_date
  loop
    if not exists (
      select 1 from public.notifications
      where user_id = r.freelancer_id
        and type = 'fl_assignment_overdue'
        and link_target = r.id::text
    ) then
      insert into public.notifications (user_id, type, title, body, link_tab, link_target)
      values (
        r.freelancer_id,
        'fl_assignment_overdue',
        'Overdue Assignment',
        'Assignment "' || r.title || '" is past due.',
        'fl_dashboard',
        r.id::text
      );
    end if;
  end loop;

  -- Due today assignments
  for r in
    select id, freelancer_id, title
    from public.freelancer_assignments
    where status <> 'completed'
      and due_date = current_date
  loop
    if not exists (
      select 1 from public.notifications
      where user_id = r.freelancer_id
        and type = 'fl_assignment_due'
        and link_target = r.id::text
    ) then
      insert into public.notifications (user_id, type, title, body, link_tab, link_target)
      values (
        r.freelancer_id,
        'fl_assignment_due',
        'Assignment Due Today',
        'Assignment "' || r.title || '" is due today.',
        'fl_dashboard',
        r.id::text
      );
    end if;
  end loop;
end;
$$;

-- One-time cleanup: collapse existing duplicates per (user_id, type, link_target)
-- down to the most recent notification only.
with ranked as (
  select id,
    row_number() over (
      partition by user_id, type, link_target
      order by created_at desc
    ) as rn
  from public.notifications
  where type in (
    'bd_task_overdue',
    'bd_task_due',
    'bd_initiative_overdue',
    'fl_assignment_overdue',
    'fl_assignment_due'
  )
)
delete from public.notifications
where id in (select id from ranked where rn > 1);
