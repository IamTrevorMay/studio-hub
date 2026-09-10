-- Pipeline view: a project's destination goal hopper.
--
-- Project type does NOT determine output format — a short_form project can end
-- up as a YT Short, a TikTok, an IG Reel or an FB Reel — so the destination is
-- its own field. Values mirror the keys in src/lib/postTypes.js so a project's
-- destination and a post_count goal's `metrics` array speak the same language.
--
-- Deliberately NOT backfilled. Routing is a human judgement per project; an
-- inferred default would silently pile every short_form project into 'short'
-- and read as intent. Unrouted projects render in their own lane instead.
alter table public.projects
  add column if not exists target_post_type text;

alter table public.projects
  drop constraint if exists projects_target_post_type_check;

alter table public.projects
  add constraint projects_target_post_type_check
  check (target_post_type is null or target_post_type in
    ('video', 'short', 'ig_reel', 'ig_carousel', 'ig_story', 'tiktok', 'fb_reel'));

comment on column public.projects.target_post_type is
  'Which goal hopper this project feeds on the Pipeline view. Null = unrouted. Keys match POST_TYPE_OPTIONS in src/lib/postTypes.js.';

create index if not exists projects_target_post_type_idx
  on public.projects (target_post_type)
  where target_post_type is not null;
