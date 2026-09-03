-- Weekly goals + post-count goal type for the Tracking page Goals section.
--
-- Weekly goals reuse the existing `goals` table under category = 'weekly'
-- (siblings of the 'yearly' rows, not children) so they inherit the same RLS,
-- scope column, and CRUD paths. They are recurring: the row stores the target
-- and the selected post types, and progress is recomputed for the current
-- Monday–Sunday PT week on every load. Nothing per-week is persisted.
--
-- `post_count` is a third goal_type alongside manual/metric. Where 'metric'
-- sums engagement columns off platform_daily_metrics, 'post_count' counts
-- published posts by type. The selected types live in the existing
-- `metrics` jsonb array, reusing the shared key vocabulary in
-- src/lib/postTypes.js: video | short | ig_reel | ig_carousel | ig_story
-- | tiktok | fb_reel.

alter table public.goals drop constraint if exists goals_goal_type_check;
alter table public.goals add constraint goals_goal_type_check
  check (goal_type = any (array['manual'::text, 'metric'::text, 'checkbox'::text, 'post_count'::text]));

-- Monthly goals keep their single-select content_type_filter; the five
-- Metricool-backed types join the existing YouTube video/short values.
-- Existing 'video'/'short' rows are untouched and keep their current counting
-- behaviour (including the TikTok special case on 'short').
alter table public.monthly_goals drop constraint if exists monthly_goals_content_type_filter_check;
alter table public.monthly_goals add constraint monthly_goals_content_type_filter_check
  check (content_type_filter = any (array[
    'video'::text, 'short'::text,
    'ig_reel'::text, 'ig_carousel'::text, 'ig_story'::text,
    'tiktok'::text, 'fb_reel'::text
  ]));

-- The section now filters goals by (scope, category) on every load.
create index if not exists goals_scope_category_idx on public.goals (scope, category);
