-- Rotate CRON_SECRET. Old value (300897BA-...) was leaked in git history
-- and a client bundle. New value below is hardcoded in pg_cron commands;
-- the edge function CRON_SECRET env var must be updated to match before
-- this migration takes effect in production.
--
-- IMPORTANT: After applying, set CRON_SECRET=50EBC188-6315-49DF-8319-44736B5B655D
-- in the Supabase Edge Functions environment variables.

SELECT cron.unschedule('daily-fetch-graphics');
SELECT cron.schedule(
  'daily-fetch-graphics',
  '0 13 * * *',
  $$select net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/fetch-daily-graphics?secret=50EBC188-6315-49DF-8319-44736B5B655D',
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb
  )$$
);

SELECT cron.unschedule('daily-generate-trends');
SELECT cron.schedule(
  'daily-generate-trends',
  '0 15 * * *',
  $$select net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/generate-trends?secret=50EBC188-6315-49DF-8319-44736B5B655D',
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb
  )$$
);

SELECT cron.unschedule('daily-post-graphics');
SELECT cron.schedule(
  'daily-post-graphics',
  '15 13 * * *',
  $$select net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/post-daily-graphics?secret=50EBC188-6315-49DF-8319-44736B5B655D',
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb
  )$$
);

SELECT cron.unschedule('nightly-snapshot-daily-work');
SELECT cron.schedule(
  'nightly-snapshot-daily-work',
  '59 7 * * *',
  $$select net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/snapshot-daily-work?secret=50EBC188-6315-49DF-8319-44736B5B655D',
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb
  )$$
);

SELECT cron.unschedule('run-reports');
SELECT cron.schedule(
  'run-reports',
  '5 15 * * *',
  $$select net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/run-report?secret=50EBC188-6315-49DF-8319-44736B5B655D',
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb
  )$$
);
