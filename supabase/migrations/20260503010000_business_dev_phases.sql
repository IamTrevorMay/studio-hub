-- Add multi-phase support to Business Dev.
-- A "phase" is its own self-contained program (name, launch target,
-- milestones, initiatives, tasks). The original single-program data
-- migrates to a default Phase 1 named after the original subtitle.

-- ============================================================
-- bd_phases
-- ============================================================
create table if not exists bd_phases (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  launch_target_date date,
  position int not null default 0,
  archived_at timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bd_phases_position_idx on bd_phases(position);

alter table bd_phases enable row level security;

create policy "bd_phases admin all" on bd_phases
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

alter publication supabase_realtime add table bd_phases;

drop trigger if exists bd_phases_touch on bd_phases;
create trigger bd_phases_touch
  before update on bd_phases
  for each row execute function public.bd_touch_updated_at();

-- ============================================================
-- Seed Phase 1 with existing launch date (if any)
-- ============================================================
insert into bd_phases (id, name, launch_target_date, position)
select
  gen_random_uuid(),
  'Mayday Media + Neptune Performance — buildout & ops',
  (select launch_target_date from bd_settings where id = 1),
  0
where not exists (select 1 from bd_phases);

-- ============================================================
-- Add phase_id to bd_initiatives + bd_milestones, backfill
-- ============================================================
alter table bd_initiatives add column if not exists phase_id uuid references bd_phases(id) on delete cascade;
alter table bd_milestones  add column if not exists phase_id uuid references bd_phases(id) on delete cascade;

update bd_initiatives
  set phase_id = (select id from bd_phases order by position limit 1)
  where phase_id is null;

update bd_milestones
  set phase_id = (select id from bd_phases order by position limit 1)
  where phase_id is null;

-- Now make required
alter table bd_initiatives alter column phase_id set not null;
alter table bd_milestones  alter column phase_id set not null;

create index if not exists bd_initiatives_phase_idx on bd_initiatives(phase_id);
create index if not exists bd_milestones_phase_idx on bd_milestones(phase_id);

-- ============================================================
-- Drop launch_target_date from bd_settings (now per-phase)
-- ============================================================
alter table bd_settings drop column if exists launch_target_date;
