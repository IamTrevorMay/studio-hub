-- pg_cron job that drains scheduled email sends.
--
-- Wakes once per minute and POSTs /api/emails/cron on the Vercel
-- deployment. The handler picks up any rows in email_sends with
-- status='scheduled' AND scheduled_at <= now() (and stalled status='sending'
-- rows from a previous run).
--
-- Secret comes from the Supabase Vault (key 'cron_secret') — same
-- pattern as the other sync-* and run-* crons. Host is hardcoded to
-- the default Vercel deployment; swap the URL string below if you've
-- bound a custom domain to the studio-hub project.
--
-- Re-running this migration is safe: the schedule is unscheduled first,
-- then re-created.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
begin
  perform cron.unschedule('mailer-drain-scheduled-sends');
exception when others then
  null; -- not previously scheduled, fine
end $$;

select cron.schedule(
  'mailer-drain-scheduled-sends',
  '* * * * *',
  $cron$
    select net.http_post(
      url := 'https://studio-hub.vercel.app/api/emails/cron',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' ||
          (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      body := '{}'::jsonb
    )
  $cron$
);
