-- Shared Ideas list on the Write page. Modeled after dashboard_todos but
-- visible and editable to every authenticated user (no per-user RLS).
-- Skips the "delete checked rows on load" behavior the dashboard uses,
-- because in a shared context that would let any user wipe everyone
-- else's checked items just by reloading.

create table if not exists public.write_ideas (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  checked boolean not null default false,
  position integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists write_ideas_position_idx
  on public.write_ideas (position);

alter table public.write_ideas enable row level security;

create policy "write_ideas: select all authenticated"
  on public.write_ideas for select
  using (auth.role() = 'authenticated');

create policy "write_ideas: insert all authenticated"
  on public.write_ideas for insert
  with check (auth.role() = 'authenticated');

create policy "write_ideas: update all authenticated"
  on public.write_ideas for update
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy "write_ideas: delete all authenticated"
  on public.write_ideas for delete
  using (auth.role() = 'authenticated');
