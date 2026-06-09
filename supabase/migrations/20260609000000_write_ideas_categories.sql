-- Split the shared Ideas list into 4 category columns:
--   mayday_videos          (was the single "Ideas" list — backfill target)
--   tm_baseball_videos
--   short_form_only
--   podcast_only
-- All existing rows land in mayday_videos via the column default.

alter table public.write_ideas
  add column if not exists category text not null default 'mayday_videos';

alter table public.write_ideas
  drop constraint if exists write_ideas_category_check;

alter table public.write_ideas
  add constraint write_ideas_category_check
  check (category in ('mayday_videos', 'tm_baseball_videos', 'short_form_only', 'podcast_only'));

-- Position is now per-category; index reflects that.
drop index if exists public.write_ideas_position_idx;
create index if not exists write_ideas_category_position_idx
  on public.write_ideas (category, position);
