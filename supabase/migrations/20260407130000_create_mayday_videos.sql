-- Mayday Videos: 6-column kanban for video production pipeline
create table public.mayday_videos (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  stage text not null default 'idea',
  sponsor_read_id uuid references public.sponsor_reads(id) on delete set null,
  sort_order int default 0,
  is_archived boolean default false,
  created_by uuid references auth.users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.mayday_videos enable row level security;

create policy "Authenticated users can select mayday_videos"
  on public.mayday_videos for select to authenticated using (true);

create policy "Authenticated users can insert mayday_videos"
  on public.mayday_videos for insert to authenticated with check (true);

create policy "Authenticated users can update mayday_videos"
  on public.mayday_videos for update to authenticated using (true) with check (true);

create policy "Authenticated users can delete mayday_videos"
  on public.mayday_videos for delete to authenticated using (true);
