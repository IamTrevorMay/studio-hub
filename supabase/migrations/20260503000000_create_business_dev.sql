-- Business Dev page tables
-- Permanent program tracker for Mayday Media + Neptune Performance buildout & ops.
-- Admin-only (RLS).

-- ============================================================
-- Helper: admin check
-- ============================================================
create or replace function public.is_admin(uid uuid)
returns boolean
language sql
stable
security definer
as $$
  select exists (
    select 1 from public.profiles
    where id = uid and role = 'admin'
  );
$$;

-- ============================================================
-- bd_settings (single row)
-- ============================================================
create table if not exists bd_settings (
  id int primary key default 1,
  launch_target_date date,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  constraint bd_settings_singleton check (id = 1)
);

insert into bd_settings (id) values (1) on conflict do nothing;

-- ============================================================
-- bd_initiatives
-- ============================================================
create table if not exists bd_initiatives (
  id uuid primary key default gen_random_uuid(),
  workstream text not null check (workstream in (
    'facility','product','marketing','sales','operations','finance','tech'
  )),
  title text not null,
  description text,
  status text not null default 'ideas' check (status in (
    'ideas','planned','active','waiting','done'
  )),
  tag text not null default 'shared' check (tag in ('mayday','neptune','shared')),
  owner_id uuid references profiles(id),
  target_date date,
  budget_cents bigint,
  priority text not null default 'med' check (priority in ('high','med','low')),
  position int not null default 0,
  completed_at timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bd_initiatives_workstream_idx on bd_initiatives(workstream);
create index if not exists bd_initiatives_status_idx on bd_initiatives(status);
create index if not exists bd_initiatives_owner_idx on bd_initiatives(owner_id);

-- ============================================================
-- bd_initiative_links
-- ============================================================
create table if not exists bd_initiative_links (
  id uuid primary key default gen_random_uuid(),
  initiative_id uuid not null references bd_initiatives(id) on delete cascade,
  label text not null,
  url text not null,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists bd_initiative_links_initiative_idx on bd_initiative_links(initiative_id);

-- ============================================================
-- bd_tasks
-- ============================================================
create table if not exists bd_tasks (
  id uuid primary key default gen_random_uuid(),
  initiative_id uuid not null references bd_initiatives(id) on delete cascade,
  title text not null,
  notes text,
  tag text check (tag in ('mayday','neptune','shared')), -- null = inherit from initiative
  owner_id uuid references profiles(id),
  due_date date,
  completed_at timestamptz,
  recurrence_interval text check (recurrence_interval in ('daily','weekly','monthly')),
  recurrence_count int default 1 check (recurrence_count >= 1),
  position int not null default 0,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bd_tasks_initiative_idx on bd_tasks(initiative_id);
create index if not exists bd_tasks_owner_idx on bd_tasks(owner_id);
create index if not exists bd_tasks_due_date_idx on bd_tasks(due_date) where completed_at is null;

-- ============================================================
-- bd_milestones
-- ============================================================
create table if not exists bd_milestones (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  target_date date,
  position int not null default 0,
  retired_at timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- ============================================================
-- RLS — admin only across all bd_* tables
-- ============================================================
alter table bd_settings enable row level security;
alter table bd_initiatives enable row level security;
alter table bd_initiative_links enable row level security;
alter table bd_tasks enable row level security;
alter table bd_milestones enable row level security;

create policy "bd_settings admin all" on bd_settings
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "bd_initiatives admin all" on bd_initiatives
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "bd_initiative_links admin all" on bd_initiative_links
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "bd_tasks admin all" on bd_tasks
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create policy "bd_milestones admin all" on bd_milestones
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- ============================================================
-- Realtime
-- ============================================================
alter publication supabase_realtime add table bd_settings;
alter publication supabase_realtime add table bd_initiatives;
alter publication supabase_realtime add table bd_initiative_links;
alter publication supabase_realtime add table bd_tasks;
alter publication supabase_realtime add table bd_milestones;

-- ============================================================
-- Auto-update updated_at on bd_initiatives / bd_tasks
-- ============================================================
create or replace function public.bd_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists bd_initiatives_touch on bd_initiatives;
create trigger bd_initiatives_touch
  before update on bd_initiatives
  for each row execute function public.bd_touch_updated_at();

drop trigger if exists bd_tasks_touch on bd_tasks;
create trigger bd_tasks_touch
  before update on bd_tasks
  for each row execute function public.bd_touch_updated_at();

-- ============================================================
-- Recurrence: when a recurring task is checked off,
-- spawn the next instance with shifted due_date.
-- ============================================================
create or replace function public.bd_spawn_recurring_task()
returns trigger language plpgsql as $$
declare
  next_due date;
begin
  -- Only act when transitioning from incomplete -> complete on a recurring task
  if old.completed_at is null
     and new.completed_at is not null
     and new.recurrence_interval is not null
     and new.due_date is not null then
    next_due := case new.recurrence_interval
      when 'daily'   then (new.due_date + (new.recurrence_count || ' days')::interval)::date
      when 'weekly'  then (new.due_date + (new.recurrence_count || ' weeks')::interval)::date
      when 'monthly' then (new.due_date + (new.recurrence_count || ' months')::interval)::date
    end;

    insert into bd_tasks (
      initiative_id, title, notes, tag, owner_id, due_date,
      recurrence_interval, recurrence_count, position, created_by
    ) values (
      new.initiative_id, new.title, new.notes, new.tag, new.owner_id, next_due,
      new.recurrence_interval, new.recurrence_count, new.position, new.created_by
    );
  end if;
  return new;
end;
$$;

drop trigger if exists bd_tasks_recur on bd_tasks;
create trigger bd_tasks_recur
  after update on bd_tasks
  for each row execute function public.bd_spawn_recurring_task();

-- ============================================================
-- Grants for is_admin helper
-- ============================================================
grant execute on function public.is_admin(uuid) to authenticated;
