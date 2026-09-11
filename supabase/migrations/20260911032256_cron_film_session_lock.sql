-- 6am PT film-session lock job.
--
-- pg_cron is UTC-only, so two slots cover both offsets: 13:05 UTC is 6:05am
-- PDT, 14:05 UTC is 6:05am PST. The film-queue function gates on the real PT
-- hour (must be 6) for cron-authed calls, so exactly one slot does work on any
-- given day. Minutes are offset from the 13:00/14:00 jobs already scheduled
-- (daily-fetch-graphics, payroll) to avoid stacking.
--
-- Prereq: the `cron_secret` Vault secret (see 20260601140000_cron_secret_via_vault.sql)
-- matching the CRON_SECRET env var on the film-queue edge function.

-- Idempotent: drop any prior copies so a re-run can't double-schedule
-- (duplicate jobs would race each other on the same session).
select cron.unschedule(jobid) from cron.job where jobname in ('film-session-lock-pdt', 'film-session-lock-pst');

select cron.schedule(
  'film-session-lock-pdt',
  '5 13 * * *',
  $$
  select net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/film-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{"action":"lock_session"}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

select cron.schedule(
  'film-session-lock-pst',
  '5 14 * * *',
  $$
  select net.http_post(
    url := 'https://ytfjkoxowfskuibdsfea.supabase.co/functions/v1/film-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{"action":"lock_session"}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
