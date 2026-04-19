-- Daily Tiller revenue sync at 7am UTC (midnight PT)
SELECT cron.schedule(
  'sync-tiller',
  '0 7 * * *',
  $$SELECT net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/sync-tiller',
    headers := '{}'::jsonb
  )$$
);
