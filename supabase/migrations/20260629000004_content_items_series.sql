-- Phase 3: optional "series" grouping for recurring shows/segments on
-- content_items. Format is derived in-app from the existing content_type enum,
-- so no format column is needed; series is a free-text grouping the team can set
-- to compare recurring formats (e.g. a weekly segment) over time.
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS series text;
CREATE INDEX IF NOT EXISTS idx_content_items_series ON content_items (series) WHERE series IS NOT NULL;