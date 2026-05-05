-- Link bd_tasks to personal_tasks so a task assigned to an owner
-- mirrors into that owner's MyBoard backlog and stays in sync.

alter table public.personal_tasks
  add column if not exists bd_task_id uuid references public.bd_tasks(id) on delete cascade;

create index if not exists personal_tasks_bd_task_idx on public.personal_tasks(bd_task_id);

-- Relink any personal_tasks the old auto-add hook created (matched by content + owner)
update public.personal_tasks pt
set bd_task_id = bt.id
from public.bd_tasks bt
join public.bd_initiatives bi on bi.id = bt.initiative_id
where pt.bd_task_id is null
  and pt.category = 'business_development'
  and pt.created_by = bt.owner_id
  and pt.content = bt.title || ' | ' || bi.title;

-- Ensure each owner has the right bucket option (Mayday/Neptune/Shared)
insert into public.user_task_options (user_id, kind, value, label, color)
select distinct
  bt.owner_id,
  'bucket',
  coalesce(bt.tag, bi.tag, 'shared'),
  initcap(coalesce(bt.tag, bi.tag, 'shared')),
  case coalesce(bt.tag, bi.tag, 'shared')
    when 'mayday'  then '#6366f1'
    when 'neptune' then '#06b6d4'
    when 'shared'  then '#a78bfa'
    else '#a78bfa'
  end
from public.bd_tasks bt
join public.bd_initiatives bi on bi.id = bt.initiative_id
where bt.owner_id is not null
  and bt.completed_at is null
on conflict (user_id, kind, value) do nothing;

-- Backfill: insert backlog rows for any open bd_task with an owner that doesn't have one
insert into public.personal_tasks (
  created_by, content, status, category, bucket, due_date, position, bd_task_id
)
select
  bt.owner_id,
  bt.title || ' | ' || bi.title,
  'backlog',
  'business_development',
  coalesce(bt.tag, bi.tag, 'shared'),
  bt.due_date,
  0,
  bt.id
from public.bd_tasks bt
join public.bd_initiatives bi on bi.id = bt.initiative_id
where bt.owner_id is not null
  and bt.completed_at is null
  and not exists (
    select 1 from public.personal_tasks pt where pt.bd_task_id = bt.id
  );
