-- Split num_videos/pay into per-channel fields
ALTER TABLE ad_read_proposals
  ADD COLUMN num_videos_mayday INT,
  ADD COLUMN num_videos_tmb INT,
  ADD COLUMN pay_per_video_mayday NUMERIC,
  ADD COLUMN pay_per_video_tmb NUMERIC;

-- Migrate existing data: put old values into mayday fields as a reasonable default
UPDATE ad_read_proposals
SET num_videos_mayday = num_videos,
    pay_per_video_mayday = pay
WHERE num_videos IS NOT NULL OR pay IS NOT NULL;

-- Drop old columns
ALTER TABLE ad_read_proposals
  DROP COLUMN num_videos,
  DROP COLUMN pay;
