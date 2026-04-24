-- Archive published creative projects and completed business projects nightly at midnight PST (08:00 UTC).
-- This clears the Published and Completed columns on the Projects kanban each night.

create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'nightly-clear-completed-projects',
  '0 8 * * *',
  $$
  UPDATE public.projects
  SET is_archived = true, updated_at = now()
  WHERE is_archived = false
    AND (
      (category = 'creative' AND status = 'published')
      OR (category = 'business' AND status = 'completed')
    )
  $$
);
