-- Team canvases (Obsidian-Canvas-style boards) shown as a view on the
-- Resources page. content holds the React Flow document: { nodes, edges,
-- viewport }. Team-wide read/write; agency accounts excluded.
create table if not exists public.canvases (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.canvases enable row level security;

create policy "canvases: select staff"
  on public.canvases for select
  using (auth.role() = 'authenticated' and not public.is_agency(auth.uid()));

create policy "canvases: insert staff"
  on public.canvases for insert
  with check (auth.role() = 'authenticated' and not public.is_agency(auth.uid()));

create policy "canvases: update staff"
  on public.canvases for update
  using (auth.role() = 'authenticated' and not public.is_agency(auth.uid()))
  with check (auth.role() = 'authenticated' and not public.is_agency(auth.uid()));

create policy "canvases: delete staff"
  on public.canvases for delete
  using (auth.role() = 'authenticated' and not public.is_agency(auth.uid()));
