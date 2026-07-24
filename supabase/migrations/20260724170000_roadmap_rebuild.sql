-- ============================================================
-- Roadmap rebuild
-- Replaces the Phase→Workstream→Initiative→Task/Milestone model
-- (bd_* tables, left dormant) with a simpler:
--   Roadmap → Milestone → Task
-- Access: admin-tier full read/write; partner role read-only.
-- Cascade: completing a milestone auto-completes its open tasks
--          (server-side trigger). Un-completing leaves tasks as-is.
-- Additive only — does NOT drop any bd_* tables.
-- ============================================================

-- ── roadmaps ─────────────────────────────────────────────────
create table if not exists public.roadmaps (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  deadline_name text,
  deadline_date date,
  position      int  not null default 0,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ── roadmap_milestones ───────────────────────────────────────
create table if not exists public.roadmap_milestones (
  id           uuid primary key default gen_random_uuid(),
  roadmap_id   uuid not null references public.roadmaps(id) on delete cascade,
  title        text not null,
  target_date  date,
  completed_at timestamptz,
  position     int  not null default 0,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ── roadmap_tasks ────────────────────────────────────────────
create table if not exists public.roadmap_tasks (
  id           uuid primary key default gen_random_uuid(),
  milestone_id uuid not null references public.roadmap_milestones(id) on delete cascade,
  title        text not null,
  description  text,
  due_date     date,
  completed_at timestamptz,
  position     int  not null default 0,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ── Indexes ──────────────────────────────────────────────────
create index if not exists roadmap_milestones_roadmap_idx on public.roadmap_milestones(roadmap_id);
create index if not exists roadmap_milestones_pos_idx      on public.roadmap_milestones(roadmap_id, position);
create index if not exists roadmap_tasks_milestone_idx     on public.roadmap_tasks(milestone_id);
create index if not exists roadmap_tasks_pos_idx           on public.roadmap_tasks(milestone_id, position);

-- ============================================================
-- Row Level Security
-- Read : admin-tier (is_admin covers admin + directors) OR partner
-- Write: admin-tier only
-- ============================================================
alter table public.roadmaps            enable row level security;
alter table public.roadmap_milestones  enable row level security;
alter table public.roadmap_tasks       enable row level security;

-- Reader helper: admin-tier OR partner (mirrors the old bd_* partner-read intent,
-- but roadmap access is not scoped per-roadmap — every partner sees every roadmap).
create or replace function public.is_roadmap_viewer(uid uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.is_admin(uid)
      or exists (select 1 from public.profiles where id = uid and role = 'partner');
$$;
grant execute on function public.is_roadmap_viewer(uuid) to authenticated;

-- ── roadmaps policies ────────────────────────────────────────
drop policy if exists "roadmaps read"   on public.roadmaps;
drop policy if exists "roadmaps insert" on public.roadmaps;
drop policy if exists "roadmaps update" on public.roadmaps;
drop policy if exists "roadmaps delete" on public.roadmaps;

create policy "roadmaps read" on public.roadmaps
  for select to authenticated
  using (public.is_roadmap_viewer(auth.uid()));
create policy "roadmaps insert" on public.roadmaps
  for insert to authenticated
  with check (public.is_admin(auth.uid()));
create policy "roadmaps update" on public.roadmaps
  for update to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));
create policy "roadmaps delete" on public.roadmaps
  for delete to authenticated
  using (public.is_admin(auth.uid()));

-- ── roadmap_milestones policies ──────────────────────────────
drop policy if exists "roadmap_milestones read"   on public.roadmap_milestones;
drop policy if exists "roadmap_milestones insert" on public.roadmap_milestones;
drop policy if exists "roadmap_milestones update" on public.roadmap_milestones;
drop policy if exists "roadmap_milestones delete" on public.roadmap_milestones;

create policy "roadmap_milestones read" on public.roadmap_milestones
  for select to authenticated
  using (public.is_roadmap_viewer(auth.uid()));
create policy "roadmap_milestones insert" on public.roadmap_milestones
  for insert to authenticated
  with check (public.is_admin(auth.uid()));
create policy "roadmap_milestones update" on public.roadmap_milestones
  for update to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));
create policy "roadmap_milestones delete" on public.roadmap_milestones
  for delete to authenticated
  using (public.is_admin(auth.uid()));

-- ── roadmap_tasks policies ───────────────────────────────────
drop policy if exists "roadmap_tasks read"   on public.roadmap_tasks;
drop policy if exists "roadmap_tasks insert" on public.roadmap_tasks;
drop policy if exists "roadmap_tasks update" on public.roadmap_tasks;
drop policy if exists "roadmap_tasks delete" on public.roadmap_tasks;

create policy "roadmap_tasks read" on public.roadmap_tasks
  for select to authenticated
  using (public.is_roadmap_viewer(auth.uid()));
create policy "roadmap_tasks insert" on public.roadmap_tasks
  for insert to authenticated
  with check (public.is_admin(auth.uid()));
create policy "roadmap_tasks update" on public.roadmap_tasks
  for update to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));
create policy "roadmap_tasks delete" on public.roadmap_tasks
  for delete to authenticated
  using (public.is_admin(auth.uid()));

-- ============================================================
-- Ownership: stamp created_by = auth.uid() server-side so the
-- client can never spoof it (no-op for service_role inserts).
-- ============================================================
create or replace function public.roadmap_set_created_by()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists roadmaps_set_created_by on public.roadmaps;
create trigger roadmaps_set_created_by
  before insert on public.roadmaps
  for each row execute function public.roadmap_set_created_by();

drop trigger if exists roadmap_milestones_set_created_by on public.roadmap_milestones;
create trigger roadmap_milestones_set_created_by
  before insert on public.roadmap_milestones
  for each row execute function public.roadmap_set_created_by();

drop trigger if exists roadmap_tasks_set_created_by on public.roadmap_tasks;
create trigger roadmap_tasks_set_created_by
  before insert on public.roadmap_tasks
  for each row execute function public.roadmap_set_created_by();

-- ============================================================
-- Cascade: when a milestone is checked off (completed_at goes
-- null -> not-null), auto-complete all of its still-open tasks.
-- Un-checking a milestone deliberately leaves tasks untouched.
-- SECURITY DEFINER so the cascade always applies regardless of
-- the caller's task-level RLS.
-- ============================================================
create or replace function public.roadmap_milestone_cascade_complete()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.completed_at is not null and old.completed_at is null then
    update public.roadmap_tasks
       set completed_at = new.completed_at,
           updated_at   = now()
     where milestone_id = new.id
       and completed_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists roadmap_milestone_cascade on public.roadmap_milestones;
create trigger roadmap_milestone_cascade
  after update of completed_at on public.roadmap_milestones
  for each row execute function public.roadmap_milestone_cascade_complete();

-- ============================================================
-- Lock down SECURITY DEFINER functions (Supabase advisor):
-- trigger functions are never called directly; the viewer helper
-- is only used inside RLS policies (authenticated must retain it).
-- ============================================================
revoke all on function public.roadmap_set_created_by() from public, anon, authenticated;
revoke all on function public.roadmap_milestone_cascade_complete() from public, anon, authenticated;
revoke all on function public.is_roadmap_viewer(uuid) from public, anon;
grant execute on function public.is_roadmap_viewer(uuid) to authenticated;
