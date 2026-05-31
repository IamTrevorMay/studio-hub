-- Hourly cron: renew Drive watch channels that are within 24h of expiry.
-- Drive caps files.watch channel lifetime at ~7 days, so we keep them rolling.
-- Uses the same CRON_SECRET pattern as the other scheduled jobs (see
-- 20260512130000_rotate_cron_secret.sql).

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'hourly-drive-watch-renew',
  '5 * * * *',
  $$select net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/drive-watch-renew?secret=50EBC188-6315-49DF-8319-44736B5B655D',
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb
  )$$
);
