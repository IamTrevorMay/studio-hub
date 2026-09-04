-- Daily sync of Instagram / TikTok / Facebook posts into content_items.
--
-- Slots in after the rest of the sync-* family, which runs 01:01–01:13 UTC
-- (sync-youtube-dimensions, sync-metricool, sync-stripe, sync-fourthwall,
-- sync-twitch, sync-substack, sync-simplecast).
--
-- The function defaults to a rolling 30-day window rather than only new posts:
-- views, reach and watch time on recent short-form keep climbing for weeks, so
-- re-reading refreshes those numbers. content_metrics is unique on
-- (content_item_id, captured_at) and captured_at is pinned to the PT day, so a
-- re-run within the same day updates that day's snapshot instead of stacking
-- duplicate rows.

select cron.schedule(
  'sync-social-posts',
  '15 1 * * *',
  $$
  select net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/sync-social-posts?days=30',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
