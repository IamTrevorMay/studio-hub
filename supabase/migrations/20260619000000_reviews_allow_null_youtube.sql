-- Allow creating a review before its video exists.
-- Title/description/thumbnails can be pre-set; the YouTube link is added later
-- (the first version backfills these columns). review_versions stays NOT NULL —
-- no version row is created until a URL is provided.
alter table public.reviews alter column youtube_url drop not null;
alter table public.reviews alter column youtube_video_id drop not null;
