-- Route workflow/project tasks to Sprint Board for opted-in users.
-- Adds a task_id FK on personal_tasks pointing back to the workflow/project task,
-- and a per-profile toggle to enable automatic sprint card creation.

-- 1. Add task_id column to personal_tasks (links sprint card → workflow/project task)
alter table public.personal_tasks
  add column if not exists task_id uuid references public.tasks(id) on delete set null;

create index if not exists personal_tasks_task_id_idx on public.personal_tasks(task_id);

-- 2. Add route_tasks_to_sprint toggle to profiles
alter table public.profiles
  add column if not exists route_tasks_to_sprint boolean not null default false;

-- 3. Enable for Trevor
update public.profiles
set route_tasks_to_sprint = true
where id = (select id from auth.users where lower(email) = 'trevormayofficial@gmail.com');

-- 4. Backfill: create sprint cards for Trevor's existing active workflow/project tasks.
--    Places them in "in_progress" status with a generic position.
insert into public.personal_tasks (created_by, content, status, position, task_id)
select
  t.assignee_id,
  t.title,
  'in_progress',
  row_number() over (order by t.created_at) * 10,
  t.id
from public.tasks t
join public.profiles p on p.id = t.assignee_id
where p.route_tasks_to_sprint = true
  and t.status in ('active', 'pending')
  and t.assignee_id is not null
  and not exists (select 1 from public.personal_tasks pt where pt.task_id = t.id)
-- Include project tasks (have related_entity_type = 'project')
-- and tasks without a direct assignee but with sign-off rows
union all
select
  tso.user_id,
  t.title,
  'in_progress',
  row_number() over (order by t.created_at) * 10 + 1000,
  t.id
from public.tasks t
join public.task_sign_offs tso on tso.task_id = t.id
join public.profiles p on p.id = tso.user_id
where p.route_tasks_to_sprint = true
  and t.status = 'active'
  and t.requires_sign_off = true
  and tso.signed_off_at is null
  and not exists (select 1 from public.personal_tasks pt where pt.task_id = t.id and pt.created_by = tso.user_id)
on conflict do nothing;
