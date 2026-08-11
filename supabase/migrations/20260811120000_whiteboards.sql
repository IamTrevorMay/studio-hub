-- Whiteboard: shared team paint canvases (Filming nav folder).
--
-- One row per board. `content` holds the whole vector scene:
--   { objects: [ {id, type, ...} ], bg: '#hex' | null }
-- Every staff member (admin / director / member) sees and can draw on every
-- board; only the creator or an admin can rename or delete one.

create table if not exists public.whiteboards (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'Untitled board',
  content jsonb not null default '{"objects": [], "bg": null}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists whiteboards_updated_at_idx on public.whiteboards (updated_at desc);
create index if not exists whiteboards_created_by_idx on public.whiteboards (created_by);

alter table public.whiteboards enable row level security;

drop policy if exists "whiteboards select" on public.whiteboards;
create policy "whiteboards select" on public.whiteboards
  for select to authenticated
  using (is_staff(auth.uid()));

drop policy if exists "whiteboards insert" on public.whiteboards;
create policy "whiteboards insert" on public.whiteboards
  for insert to authenticated
  with check (is_staff(auth.uid()) and created_by = auth.uid());

-- Anyone on staff can draw on a shared board...
drop policy if exists "whiteboards update" on public.whiteboards;
create policy "whiteboards update" on public.whiteboards
  for update to authenticated
  using (is_staff(auth.uid()))
  with check (is_staff(auth.uid()));

-- ...but only the creator (or an admin) can throw one away.
drop policy if exists "whiteboards delete" on public.whiteboards;
create policy "whiteboards delete" on public.whiteboards
  for delete to authenticated
  using (is_admin() or created_by = auth.uid());

-- Renaming is an ownership action too, and `created_by` must never move.
-- The broad UPDATE policy can't express that, so a trigger enforces it.
create or replace function public.whiteboards_guard_update()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.title is distinct from old.title
     and old.created_by is distinct from auth.uid()
     and not is_admin() then
    raise exception 'Only the board owner or an admin can rename this board';
  end if;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists whiteboards_guard_update on public.whiteboards;
create trigger whiteboards_guard_update
  before update on public.whiteboards
  for each row execute function public.whiteboards_guard_update();

-- Realtime: the editor listens for other people's saves so it can offer a
-- reload instead of silently clobbering their work.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'whiteboards'
  ) then
    alter publication supabase_realtime add table public.whiteboards;
  end if;
end;
$$;

-- Images pasted / dropped onto a board.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'whiteboard-images', 'whiteboard-images', true, 10485760,
  array['image/png', 'image/jpeg', 'image/gif', 'image/webp']
)
on conflict (id) do nothing;

drop policy if exists "whiteboard_images_select" on storage.objects;
create policy "whiteboard_images_select" on storage.objects
  for select using (bucket_id = 'whiteboard-images');

drop policy if exists "whiteboard_images_insert" on storage.objects;
create policy "whiteboard_images_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'whiteboard-images' and is_staff(auth.uid()));

drop policy if exists "whiteboard_images_delete" on storage.objects;
create policy "whiteboard_images_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'whiteboard-images' and is_staff(auth.uid()));
