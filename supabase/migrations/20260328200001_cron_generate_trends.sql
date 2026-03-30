-- Enable required extensions
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Daily trends report at 8am Pacific (15:00 UTC)
-- Uses CRON_SECRET set in Supabase Edge Function secrets
select cron.schedule(
  'daily-generate-trends',
  '0 15 * * *',
  $$select net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/generate-trends?secret=300897BA-1E26-4328-97E8-FFB11BCF2C6D',
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb
  )$$
);
