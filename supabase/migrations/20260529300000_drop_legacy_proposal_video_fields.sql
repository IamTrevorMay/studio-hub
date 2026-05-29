-- Drop legacy aggregate video fields from ad_read_proposals.
-- Replaced by per-item rows in ad_read_proposal_items (20260528100000).

ALTER TABLE public.ad_read_proposals
  DROP COLUMN IF EXISTS num_videos_mayday,
  DROP COLUMN IF EXISTS num_videos_tmb,
  DROP COLUMN IF EXISTS pay_per_video_mayday,
  DROP COLUMN IF EXISTS pay_per_video_tmb;
