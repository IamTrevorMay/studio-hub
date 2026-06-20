-- Soft per-viewer dedup for the public jobs-view beacon. Stores a coarse hash of
-- IP+UA so jobs-view can skip duplicate inserts from the same viewer within a
-- short window, limiting trivially-scriptable analytics inflation / table bloat.
alter table public.job_listing_views add column if not exists viewer_hash text;
create index if not exists idx_job_listing_views_dedup
  on public.job_listing_views (listing_id, viewer_hash, created_at);
