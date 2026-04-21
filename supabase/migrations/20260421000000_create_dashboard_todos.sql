-- Per-user dashboard to-do list. Previously stored only in localStorage, which
-- lost data when users switched machines. Stored with RLS so each user can only
-- read and write their own rows.

create table if not exists public.dashboard_todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  text text not null,
  checked boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dashboard_todos_user_idx
  on public.dashboard_todos (user_id, position);

alter table public.dashboard_todos enable row level security;

create policy "dashboard_todos: select own"
  on public.dashboard_todos for select
  using (auth.uid() = user_id);

create policy "dashboard_todos: insert own"
  on public.dashboard_todos for insert
  with check (auth.uid() = user_id);

create policy "dashboard_todos: update own"
  on public.dashboard_todos for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "dashboard_todos: delete own"
  on public.dashboard_todos for delete
  using (auth.uid() = user_id);
