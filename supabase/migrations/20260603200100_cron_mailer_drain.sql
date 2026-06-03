-- pg_cron job that drains scheduled email sends.
--
-- Wakes once per minute and POSTs /api/emails/cron on the Vercel
-- deployment. The handler picks up any rows in email_sends with
-- status='scheduled' AND scheduled_at <= now() (and stalled status='sending'
-- rows from a previous run).
--
-- ── Manual swap required before this becomes active ─────────────────
-- Replace the two placeholders below with the live values, then run
-- this migration via Supabase SQL editor:
--   <MAYDAY_VERCEL_HOST>  → e.g. studio-hub.vercel.app  (no scheme)
--   <CRON_SECRET>          → matches the rotated app secret currently
--                            stored in Vercel env CRON_SECRET
-- ────────────────────────────────────────────────────────────────────

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Idempotent: unschedule previous job if rerun.
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
      url := 'https://<MAYDAY_VERCEL_HOST>/api/emails/cron',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer <CRON_SECRET>'
      ),
      body := '{}'::jsonb
    )
  $cron$
);
