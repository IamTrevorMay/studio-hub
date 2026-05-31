-- Every-minute cron: poll active Drive watches for new/modified files.
-- pg_cron's smallest interval is 1 minute, which sets the worst-case latency
-- between a file changing in Drive and a drive_events row appearing.
-- Uses the same CRON_SECRET pattern as the other scheduled jobs (see
-- 20260512130000_rotate_cron_secret.sql).

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'minutely-drive-watch-poll',
  '* * * * *',
  $$select net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/drive-watch-poll?secret=50EBC188-6315-49DF-8319-44736B5B655D',
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb
  )$$
);
