-- Poll Google Calendar every 10 minutes and pull edits back onto the Studio
-- events that Studio originally pushed. See supabase/functions/google-calendar-pull.
select cron.schedule(
  'google-calendar-pull',
  '*/10 * * * *',
  $$select net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/google-calendar-pull',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  )$$
);
