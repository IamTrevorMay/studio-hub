create table public.personal_task_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  content text default '',
  category text default 'administration',
  subcategory text,
  bucket text,
  priority text,
  project_id uuid references public.projects(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, name)
);

create index personal_task_templates_user_id_idx on public.personal_task_templates(user_id);

alter table public.personal_task_templates enable row level security;

create policy "Users select own templates"
  on public.personal_task_templates for select
  using (auth.uid() = user_id);

create policy "Users insert own templates"
  on public.personal_task_templates for insert
  with check (auth.uid() = user_id);

create policy "Users update own templates"
  on public.personal_task_templates for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users delete own templates"
  on public.personal_task_templates for delete
  using (auth.uid() = user_id);
