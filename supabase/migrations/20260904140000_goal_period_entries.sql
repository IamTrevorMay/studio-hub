-- Per-period values for manual goals.
--
-- Metric and post_count goals derive their history from real sources, so the
-- weekly hit/miss strip on their cards can be recomputed for any past week.
-- Manual goals had nowhere to put that: `goals.current_value` is a single
-- number with no notion of which week it belonged to, so a manual weekly goal
-- could show a bar but not a history.
--
-- One row per (goal, period). `period_key` is the same bucket key the UI uses:
--   weekly  → the Monday-start date, 'YYYY-MM-DD'
--   monthly → 'YYYY-MM'
--   yearly  → 'YYYY'
-- Only weekly is surfaced today; the shape is period-agnostic so monthly and
-- yearly manual goals can log the same way later without a migration.

create table if not exists public.goal_period_entries (
  id          uuid primary key default gen_random_uuid(),
  goal_id     uuid not null references public.goals(id) on delete cascade,
  period_key  text not null,
  value       numeric not null default 0,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  unique (goal_id, period_key)
);

create index if not exists goal_period_entries_goal_idx
  on public.goal_period_entries (goal_id, period_key);

alter table public.goal_period_entries enable row level security;

drop policy if exists "goal_period_entries_select" on public.goal_period_entries;
create policy "goal_period_entries_select" on public.goal_period_entries
  for select to authenticated using (true);

drop policy if exists "goal_period_entries_write" on public.goal_period_entries;
create policy "goal_period_entries_write" on public.goal_period_entries
  for all to authenticated using (is_admin()) with check (is_admin());

-- Seed the live week from whatever current_value the manual weekly goals are
-- already carrying, so nothing that was logged reads as zero after the switch.
insert into public.goal_period_entries (goal_id, period_key, value, created_by)
select g.id,
       to_char(
         (((now() at time zone 'America/Los_Angeles')::date)
           - ((extract(isodow from (now() at time zone 'America/Los_Angeles')::date)::int) - 1)),
         'YYYY-MM-DD'),
       g.current_value,
       g.created_by
  from public.goals g
 where g.scope = 'content'
   and g.category = 'weekly'
   and g.goal_type = 'manual'
   and coalesce(g.current_value, 0) <> 0
on conflict (goal_id, period_key) do nothing;
