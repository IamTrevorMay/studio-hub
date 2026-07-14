-- Generate Ashley's tactical Analytics read every Saturday 15:00 UTC (8am PT),
-- alongside generate-weekly-report (a SECOND job, not appended to the report's
-- body, for failure isolation). Same vault cron_secret / X-Cron-Secret pattern.
-- timeout_milliseconds is widened past pg_net's 5s default so the client waits
-- for the (Claude-bound) function to finish and records a real status_code.
select cron.schedule(
  'generate-ashley-read',
  '0 15 * * 6',
  $$select net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/generate-ashley-read',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  )$$
);
