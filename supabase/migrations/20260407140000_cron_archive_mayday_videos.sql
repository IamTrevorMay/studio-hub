-- Archive completed Mayday videos nightly at midnight PST (08:00 UTC)
create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'nightly-archive-mayday-videos',
  '0 8 * * *',
  $$UPDATE public.mayday_videos SET is_archived = true, updated_at = now() WHERE stage = 'complete' AND is_archived = false$$
);
