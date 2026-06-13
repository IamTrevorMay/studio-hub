-- Mailer scheduled-send dispatcher. Fires once a minute; the edge fn
-- atomically claims any campaigns whose scheduled_at has passed and
-- hands them off to mailer-send-now. CRON_SECRET is read from Vault
-- at execution time so it never lands in cron-job metadata.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'mailer-tick',
  '* * * * *',
  $$select net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/mailer-cron-tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'CRON_SECRET')
    ),
    body := '{}'::jsonb
  )$$
);
