-- Shorts vs long-form daily view split for YouTube channels, so Tracking-page
-- goals can target "views excluding Shorts" (or Shorts-only). Populated by
-- sync-youtube via the Analytics API creatorContentType dimension. Nullable on
-- purpose: null = the API returned no split for that date (old history, or a
-- non-YouTube platform row) — goal rollups must skip nulls, not read them as 0.

alter table public.platform_daily_metrics add column if not exists views_shorts integer;
alter table public.platform_daily_metrics add column if not exists views_long integer;
