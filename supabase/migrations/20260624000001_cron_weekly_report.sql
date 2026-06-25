-- Generate the weekly KPI report every Saturday at 15:00 UTC (8am PT).
-- Mirrors the X-Cron-Secret pattern used by mailer-cron-tick (vault cron_secret).
select cron.schedule(
  'generate-weekly-report',
  '0 15 * * 6',
  $$select net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/generate-weekly-report',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  )$$
);
