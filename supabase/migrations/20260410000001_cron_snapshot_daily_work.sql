-- Nightly snapshot of daily work at 11:59 PM Pacific (07:59 UTC)
select cron.schedule(
  'nightly-snapshot-daily-work',
  '59 7 * * *',
  $$select net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/snapshot-daily-work?secret=300897BA-1E26-4328-97E8-FFB11BCF2C6D',
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb
  )$$
);
