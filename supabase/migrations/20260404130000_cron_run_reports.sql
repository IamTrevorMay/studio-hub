-- Schedule generic report runner: daily at 8:05 AM PT (5 min after trends)
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'run-reports',
  '5 15 * * *',
  $$select net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/run-report?secret=300897BA-1E26-4328-97E8-FFB11BCF2C6D',
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb
  )$$
);
