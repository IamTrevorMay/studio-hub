-- Per-user custom options for Category / Subcategory / Bucket on personal_tasks.
-- Options are scoped to the authoring user so each person curates their own
-- taxonomy. Available on every device because they live in Supabase, not
-- localStorage. Stacks on top of code-level default options.

alter table public.personal_tasks
  add column if not exists bucket text;

create table if not exists public.user_task_options (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('category', 'subcategory', 'bucket')),
  value text not null,
  label text not null,
  color text,
  created_at timestamptz not null default now(),
  unique (user_id, kind, value)
);

create index if not exists user_task_options_user_kind_idx
  on public.user_task_options (user_id, kind);

alter table public.user_task_options enable row level security;

create policy "user_task_options: select own"
  on public.user_task_options for select
  using (auth.uid() = user_id);

create policy "user_task_options: insert own"
  on public.user_task_options for insert
  with check (auth.uid() = user_id);

create policy "user_task_options: update own"
  on public.user_task_options for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "user_task_options: delete own"
  on public.user_task_options for delete
  using (auth.uid() = user_id);
