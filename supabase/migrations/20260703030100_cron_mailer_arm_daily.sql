-- Daily trigger for the Mailer "Mayday Daily" recurring digest. Fires at 15:00
-- UTC — the same instant the retired Triton Tools sender used — pinging
-- mailer-arm-daily, which clones the active template into a dated scheduled
-- campaign; the per-minute mailer-tick then sends it via mailer-send-now.
--
-- CUTOVER NOTE: applying this migration is the go-live step. Before it fires the
-- first time, the "Mayday Daily" audience must have subscribers and the Triton
-- product (email_products 'mayday-daily') must be set is_active = false, so the
-- digest is sent exactly once from exactly one system.
select cron.schedule(
  'mailer-arm-daily',
  '0 15 * * *',
  $$
  select net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/mailer-arm-daily',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    )
  )
  $$
);
