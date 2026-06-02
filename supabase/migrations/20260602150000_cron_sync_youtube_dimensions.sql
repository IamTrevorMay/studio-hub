-- Schedule sync-youtube-dimensions to run daily at 1 AM UTC.
-- Offset from sync-youtube (every 6h) to avoid overlap.
-- Reuses existing YouTube OAuth tokens — no new credentials needed.

select cron.schedule(
  'sync-youtube-dimensions', '0 1 * * *',
  $cron$select net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/sync-youtube-dimensions',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  )$cron$
);
