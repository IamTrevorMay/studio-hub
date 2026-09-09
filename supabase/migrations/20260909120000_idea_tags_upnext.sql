-- Ideas board restructure: the four category sections collapse into one list,
-- categories become multi-select tags (custom tags allowed), and a shared
-- "Up Next" bucket sits above the main list.
--
-- `category` stays on write_ideas as a compat shim for IdeasMobile (still
-- sectioned); desktop keeps it synced to the first tag that maps to one.

create table if not exists public.idea_tags (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,
  color text not null default '#8fb4d8',
  position integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.idea_tags enable row level security;

-- Same openness as write_ideas itself: any authenticated user.
create policy "idea_tags: select all authenticated"
  on public.idea_tags for select
  using (auth.role() = 'authenticated');

create policy "idea_tags: insert all authenticated"
  on public.idea_tags for insert
  with check (auth.role() = 'authenticated');

create policy "idea_tags: update all authenticated"
  on public.idea_tags for update
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy "idea_tags: delete all authenticated"
  on public.idea_tags for delete
  using (auth.role() = 'authenticated');

-- Seed the four former sections with their existing colors.
insert into public.idea_tags (label, color, position) values
  ('Mayday Videos', '#f87171', 0),
  ('Trevor May Baseball Videos', '#34d399', 1),
  ('Short Form Only', '#fbbf24', 2),
  ('Podcast Only', '#c084fc', 3)
on conflict (label) do nothing;

alter table public.write_ideas
  add column if not exists tag_ids uuid[] not null default '{}',
  add column if not exists bucket text not null default 'list';

alter table public.write_ideas
  drop constraint if exists write_ideas_bucket_check;

alter table public.write_ideas
  add constraint write_ideas_bucket_check
  check (bucket in ('list', 'up_next'));

-- Backfill: each idea starts tagged with its former section.
update public.write_ideas w
set tag_ids = array[t.id]
from public.idea_tags t
where cardinality(w.tag_ids) = 0
  and t.label = case w.category
    when 'mayday_videos'      then 'Mayday Videos'
    when 'tm_baseball_videos' then 'Trevor May Baseball Videos'
    when 'short_form_only'    then 'Short Form Only'
    when 'podcast_only'       then 'Podcast Only'
  end;

-- Position becomes one global order per bucket. Preserve the old on-screen
-- order: sections in display order, then per-section position.
with ordered as (
  select id,
         row_number() over (
           order by case category
             when 'mayday_videos'      then 0
             when 'tm_baseball_videos' then 1
             when 'short_form_only'    then 2
             when 'podcast_only'       then 3
             else 4
           end,
           position,
           created_at
         ) - 1 as rn
  from public.write_ideas
)
update public.write_ideas w
set position = o.rn
from ordered o
where w.id = o.id;

drop index if exists public.write_ideas_category_position_idx;
create index if not exists write_ideas_bucket_position_idx
  on public.write_ideas (bucket, position);
