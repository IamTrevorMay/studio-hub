-- Pinned-post customization: a custom title and a manual sort order for the
-- pinned "table of contents" in Channels. Both nullable; existing pins fall
-- back to a content snippet for the title and to created_at for ordering.
ALTER TABLE channel_messages
  ADD COLUMN IF NOT EXISTS pin_title TEXT,
  ADD COLUMN IF NOT EXISTS pin_order INTEGER;
