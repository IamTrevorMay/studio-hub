-- Nightly Plaid bank feed sync at 12:00 UTC (5am PT) — banks post most
-- transactions overnight, so a pre-workday pull keeps Accounting current.
select cron.schedule(
  'plaid-sync-nightly',
  '0 12 * * *',
  $$select net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/plaid-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  )$$
);
