-- Switch archive-published-cards cron from weekly (Mon 08:00 UTC) to daily (08:00 UTC).
-- Edge function now archives Publish-column cards whose updated_at is older than 7 days
-- instead of older than the start of the current PT week.

select cron.unschedule('archive-published-cards');

select cron.schedule(
  'archive-published-cards',
  '0 8 * * *',
  $$select net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/archive-published-cards',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  )$$
);
