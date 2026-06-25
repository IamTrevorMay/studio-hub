-- Run backfill queue every 2 hours at :30.
select cron.schedule(
  'run-backfills',
  '30 */2 * * *',
  $$select net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/run-backfills',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  )$$
);
