-- Add 'simplecast' to the platform_type enum so platform_accounts rows for the
-- podcast (Mayday! with Trevor May) can be created and sync-simplecast can write
-- platform_daily_metrics / content_items for it.
--
-- Already applied live on the main project 2026-06-28; this file keeps source in
-- sync. ADD VALUE IF NOT EXISTS is idempotent.
--
-- NOTE: the platform_accounts row itself (which holds the Simplecast API token in
-- credentials) is created out-of-band via the dashboard/MCP — NOT in a migration,
-- to avoid committing a secret.

alter type platform_type add value if not exists 'simplecast';

-- Podcast episodes need a content_type; existing labels (video/short/post/reel/
-- story/article/newsletter/live) have no podcast value.
alter type content_type add value if not exists 'podcast';
