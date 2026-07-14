-- Ideas page: Potential Titles + admin/director ratings.
--
-- potential_titles: up to 5 candidate titles per idea (enforced client-side),
-- stored as a jsonb string array on the idea row.
--
-- idea_ratings: one 1-5 rating per (idea, rater). RLS restricts BOTH reading
-- and writing to admins + directors, so ratings are invisible to every other
-- role at the data layer, not just in the UI.
alter table public.write_ideas
  add column if not exists potential_titles jsonb not null default '[]'::jsonb;

create table if not exists public.idea_ratings (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references public.write_ideas(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  rating int not null check (rating between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (idea_id, user_id)
);

alter table public.idea_ratings enable row level security;

create policy "raters read idea ratings" on public.idea_ratings
  for select to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'director_creative', 'director_comms')
  ));

create policy "raters insert own idea rating" on public.idea_ratings
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'director_creative', 'director_comms')
    )
  );

create policy "raters update own idea rating" on public.idea_ratings
  for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'director_creative', 'director_comms')
    )
  );

create policy "raters delete own idea rating" on public.idea_ratings
  for delete to authenticated
  using (user_id = auth.uid());
