-- Clear the "Posted" column in Shorts Queue every Sunday at midnight PST (08:00 UTC)
create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'weekly-clear-posted-shorts',
  '0 8 * * 0',
  $$DELETE FROM public.shorts_queue WHERE stage = 'posted'$$
);
