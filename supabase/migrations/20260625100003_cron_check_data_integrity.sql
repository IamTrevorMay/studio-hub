-- Daily data integrity check at 17:00 UTC (10am PT).
select cron.schedule(
  'check-data-integrity',
  '0 17 * * *',
  $$select net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/check-data-integrity',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  )$$
);
