-- YouTube Studio Advanced replica: per-dimension storage for channel- and
-- video-level analytics, plus saved views and backfill progress tracking.
--
-- Dimension naming mirrors YouTube Analytics API dimensions:
--   traffic_source, external_source, search_terms, geography, city,
--   subtitles_language, playback_location, device, os, subscription_source,
--   sharing_service, subscription_status, viewer_type (new/returning),
--   age, gender, playlist
--
-- Two table families:
--   yt_dim_*        — channel-level (one row per channel/date/dimension_value)
--   yt_video_dim_*  — per-video (adds video_id)
--
-- All admin-only via RLS.

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- Shared metric column set (kept consistent across dim tables)
-- ─────────────────────────────────────────────────────────────
-- Channel-level dimension tables
CREATE TABLE IF NOT EXISTS public.yt_dim_traffic_source (
  id BIGSERIAL PRIMARY KEY,
  platform_account_id UUID NOT NULL REFERENCES public.platform_accounts(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  dimension_value TEXT NOT NULL,
  views BIGINT DEFAULT 0,
  watch_time_minutes NUMERIC(14,2) DEFAULT 0,
  average_view_duration_seconds NUMERIC(10,2) DEFAULT 0,
  average_view_percentage NUMERIC(8,4) DEFAULT 0,
  subscribers_gained BIGINT DEFAULT 0,
  subscribers_lost BIGINT DEFAULT 0,
  likes BIGINT DEFAULT 0,
  dislikes BIGINT DEFAULT 0,
  comments BIGINT DEFAULT 0,
  shares BIGINT DEFAULT 0,
  estimated_revenue NUMERIC(14,4) DEFAULT 0,
  ad_revenue NUMERIC(14,4) DEFAULT 0,
  gross_revenue NUMERIC(14,4) DEFAULT 0,
  premium_revenue NUMERIC(14,4) DEFAULT 0,
  monetized_playbacks BIGINT DEFAULT 0,
  playback_based_cpm NUMERIC(10,4) DEFAULT 0,
  cpm NUMERIC(10,4) DEFAULT 0,
  ad_impressions BIGINT DEFAULT 0,
  impressions BIGINT DEFAULT 0,
  impressions_ctr NUMERIC(8,4) DEFAULT 0,
  unique_viewers BIGINT DEFAULT 0,
  viewer_percentage NUMERIC(8,4) DEFAULT 0,
  red_views BIGINT DEFAULT 0,
  red_watch_time_minutes NUMERIC(14,2) DEFAULT 0,
  videos_added_to_playlists BIGINT DEFAULT 0,
  videos_removed_from_playlists BIGINT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (platform_account_id, date, dimension_value)
);
CREATE INDEX IF NOT EXISTS idx_yt_dim_traffic_source_acc_date ON public.yt_dim_traffic_source (platform_account_id, date);

-- Macro-style cloning via dynamic SQL would be overkill; just repeat the
-- schema across the dimension set. Each table is structurally identical to
-- yt_dim_traffic_source above.
CREATE TABLE IF NOT EXISTS public.yt_dim_external          (LIKE public.yt_dim_traffic_source INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.yt_dim_search_terms      (LIKE public.yt_dim_traffic_source INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.yt_dim_geography         (LIKE public.yt_dim_traffic_source INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.yt_dim_city              (LIKE public.yt_dim_traffic_source INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.yt_dim_subtitles         (LIKE public.yt_dim_traffic_source INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.yt_dim_playback_location (LIKE public.yt_dim_traffic_source INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.yt_dim_device            (LIKE public.yt_dim_traffic_source INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.yt_dim_os                (LIKE public.yt_dim_traffic_source INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.yt_dim_subscription_source (LIKE public.yt_dim_traffic_source INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.yt_dim_sharing_service   (LIKE public.yt_dim_traffic_source INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.yt_dim_subscription_status (LIKE public.yt_dim_traffic_source INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.yt_dim_viewer_type       (LIKE public.yt_dim_traffic_source INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.yt_dim_age               (LIKE public.yt_dim_traffic_source INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.yt_dim_gender            (LIKE public.yt_dim_traffic_source INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.yt_dim_playlist          (LIKE public.yt_dim_traffic_source INCLUDING ALL);

-- LIKE ... INCLUDING ALL copies indexes & constraints. Re-add FK because
-- CONSTRAINTS are copied but FK is not (Postgres limitation).
DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'yt_dim_external','yt_dim_search_terms','yt_dim_geography','yt_dim_city',
    'yt_dim_subtitles','yt_dim_playback_location','yt_dim_device','yt_dim_os',
    'yt_dim_subscription_source','yt_dim_sharing_service','yt_dim_subscription_status',
    'yt_dim_viewer_type','yt_dim_age','yt_dim_gender','yt_dim_playlist'
  ])
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (platform_account_id) REFERENCES public.platform_accounts(id) ON DELETE CASCADE',
      t, t || '_pa_fkey'
    );
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────
-- Per-video dimensional tables (add video_id)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.yt_video_dim_traffic_source (
  id BIGSERIAL PRIMARY KEY,
  platform_account_id UUID NOT NULL REFERENCES public.platform_accounts(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL,
  date DATE NOT NULL,
  dimension_value TEXT NOT NULL,
  views BIGINT DEFAULT 0,
  watch_time_minutes NUMERIC(14,2) DEFAULT 0,
  average_view_duration_seconds NUMERIC(10,2) DEFAULT 0,
  average_view_percentage NUMERIC(8,4) DEFAULT 0,
  subscribers_gained BIGINT DEFAULT 0,
  subscribers_lost BIGINT DEFAULT 0,
  likes BIGINT DEFAULT 0,
  dislikes BIGINT DEFAULT 0,
  comments BIGINT DEFAULT 0,
  shares BIGINT DEFAULT 0,
  estimated_revenue NUMERIC(14,4) DEFAULT 0,
  ad_revenue NUMERIC(14,4) DEFAULT 0,
  gross_revenue NUMERIC(14,4) DEFAULT 0,
  premium_revenue NUMERIC(14,4) DEFAULT 0,
  monetized_playbacks BIGINT DEFAULT 0,
  playback_based_cpm NUMERIC(10,4) DEFAULT 0,
  cpm NUMERIC(10,4) DEFAULT 0,
  ad_impressions BIGINT DEFAULT 0,
  impressions BIGINT DEFAULT 0,
  impressions_ctr NUMERIC(8,4) DEFAULT 0,
  unique_viewers BIGINT DEFAULT 0,
  viewer_percentage NUMERIC(8,4) DEFAULT 0,
  red_views BIGINT DEFAULT 0,
  red_watch_time_minutes NUMERIC(14,2) DEFAULT 0,
  videos_added_to_playlists BIGINT DEFAULT 0,
  videos_removed_from_playlists BIGINT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (platform_account_id, video_id, date, dimension_value)
);
CREATE INDEX IF NOT EXISTS idx_yt_video_dim_traffic_source_video ON public.yt_video_dim_traffic_source (platform_account_id, video_id, date);

CREATE TABLE IF NOT EXISTS public.yt_video_dim_external           (LIKE public.yt_video_dim_traffic_source INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.yt_video_dim_search_terms       (LIKE public.yt_video_dim_traffic_source INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.yt_video_dim_geography          (LIKE public.yt_video_dim_traffic_source INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.yt_video_dim_city               (LIKE public.yt_video_dim_traffic_source INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.yt_video_dim_subtitles          (LIKE public.yt_video_dim_traffic_source INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.yt_video_dim_playback_location  (LIKE public.yt_video_dim_traffic_source INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.yt_video_dim_device             (LIKE public.yt_video_dim_traffic_source INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.yt_video_dim_os                 (LIKE public.yt_video_dim_traffic_source INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.yt_video_dim_subscription_source (LIKE public.yt_video_dim_traffic_source INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.yt_video_dim_sharing_service    (LIKE public.yt_video_dim_traffic_source INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.yt_video_dim_subscription_status (LIKE public.yt_video_dim_traffic_source INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.yt_video_dim_viewer_type        (LIKE public.yt_video_dim_traffic_source INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.yt_video_dim_age                (LIKE public.yt_video_dim_traffic_source INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.yt_video_dim_gender             (LIKE public.yt_video_dim_traffic_source INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.yt_video_dim_playlist           (LIKE public.yt_video_dim_traffic_source INCLUDING ALL);

DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'yt_video_dim_external','yt_video_dim_search_terms','yt_video_dim_geography','yt_video_dim_city',
    'yt_video_dim_subtitles','yt_video_dim_playback_location','yt_video_dim_device','yt_video_dim_os',
    'yt_video_dim_subscription_source','yt_video_dim_sharing_service','yt_video_dim_subscription_status',
    'yt_video_dim_viewer_type','yt_video_dim_age','yt_video_dim_gender','yt_video_dim_playlist'
  ])
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (platform_account_id) REFERENCES public.platform_accounts(id) ON DELETE CASCADE',
      t, t || '_pa_fkey'
    );
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────
-- Per-video daily metrics (no extra dimension — the Content row pivot)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.yt_video_daily (
  id BIGSERIAL PRIMARY KEY,
  platform_account_id UUID NOT NULL REFERENCES public.platform_accounts(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL,
  date DATE NOT NULL,
  views BIGINT DEFAULT 0,
  watch_time_minutes NUMERIC(14,2) DEFAULT 0,
  average_view_duration_seconds NUMERIC(10,2) DEFAULT 0,
  average_view_percentage NUMERIC(8,4) DEFAULT 0,
  subscribers_gained BIGINT DEFAULT 0,
  subscribers_lost BIGINT DEFAULT 0,
  likes BIGINT DEFAULT 0,
  dislikes BIGINT DEFAULT 0,
  comments BIGINT DEFAULT 0,
  shares BIGINT DEFAULT 0,
  estimated_revenue NUMERIC(14,4) DEFAULT 0,
  ad_revenue NUMERIC(14,4) DEFAULT 0,
  gross_revenue NUMERIC(14,4) DEFAULT 0,
  premium_revenue NUMERIC(14,4) DEFAULT 0,
  monetized_playbacks BIGINT DEFAULT 0,
  playback_based_cpm NUMERIC(10,4) DEFAULT 0,
  cpm NUMERIC(10,4) DEFAULT 0,
  ad_impressions BIGINT DEFAULT 0,
  impressions BIGINT DEFAULT 0,
  impressions_ctr NUMERIC(8,4) DEFAULT 0,
  unique_viewers BIGINT DEFAULT 0,
  red_views BIGINT DEFAULT 0,
  red_watch_time_minutes BIGINT DEFAULT 0,
  videos_added_to_playlists BIGINT DEFAULT 0,
  videos_removed_from_playlists BIGINT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (platform_account_id, video_id, date)
);
CREATE INDEX IF NOT EXISTS idx_yt_video_daily_acc_date ON public.yt_video_daily (platform_account_id, date);
CREATE INDEX IF NOT EXISTS idx_yt_video_daily_video ON public.yt_video_daily (platform_account_id, video_id);

-- ─────────────────────────────────────────────────────────────
-- Saved views (per-user dimension/metric/date presets)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.yt_studio_saved_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, name)
);
CREATE INDEX IF NOT EXISTS idx_yt_studio_saved_views_user ON public.yt_studio_saved_views (user_id);

-- ─────────────────────────────────────────────────────────────
-- Backfill progress (resumable cursor for backfill-youtube-dimensions)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.yt_backfill_progress (
  id BIGSERIAL PRIMARY KEY,
  platform_account_id UUID NOT NULL REFERENCES public.platform_accounts(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,           -- 'channel' or 'video'
  dimension TEXT NOT NULL,        -- e.g. 'traffic_source'
  video_id TEXT,                  -- null for channel scope
  last_completed_through DATE,    -- last date inclusive that has been synced
  status TEXT DEFAULT 'pending',  -- pending|running|complete|failed
  error_message TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (platform_account_id, scope, dimension, video_id)
);
CREATE INDEX IF NOT EXISTS idx_yt_backfill_progress_status ON public.yt_backfill_progress (status);

-- ─────────────────────────────────────────────────────────────
-- RLS: admin-only for all new tables
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  t TEXT;
  tbls TEXT[] := ARRAY[
    'yt_dim_traffic_source','yt_dim_external','yt_dim_search_terms','yt_dim_geography','yt_dim_city',
    'yt_dim_subtitles','yt_dim_playback_location','yt_dim_device','yt_dim_os',
    'yt_dim_subscription_source','yt_dim_sharing_service','yt_dim_subscription_status',
    'yt_dim_viewer_type','yt_dim_age','yt_dim_gender','yt_dim_playlist',
    'yt_video_dim_traffic_source','yt_video_dim_external','yt_video_dim_search_terms',
    'yt_video_dim_geography','yt_video_dim_city','yt_video_dim_subtitles',
    'yt_video_dim_playback_location','yt_video_dim_device','yt_video_dim_os',
    'yt_video_dim_subscription_source','yt_video_dim_sharing_service','yt_video_dim_subscription_status',
    'yt_video_dim_viewer_type','yt_video_dim_age','yt_video_dim_gender','yt_video_dim_playlist',
    'yt_video_daily','yt_backfill_progress'
  ];
BEGIN
  FOREACH t IN ARRAY tbls
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      t || '_admin_all', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (
         EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = ''admin'')
       ) WITH CHECK (
         EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = ''admin'')
       )',
      t || '_admin_all', t
    );
  END LOOP;
END $$;

-- Saved views: owner-scoped
ALTER TABLE public.yt_studio_saved_views ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS yt_studio_saved_views_owner ON public.yt_studio_saved_views;
CREATE POLICY yt_studio_saved_views_owner ON public.yt_studio_saved_views
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

COMMIT;
