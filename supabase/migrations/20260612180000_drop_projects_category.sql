-- Remove the Business board entirely. The 4-type Unified Content Kanban
-- replaces it; existing business-category projects were already soft-archived.

-- Drop the legacy archive cron (replaced by archive-published-cards daily).
do $$
begin
  perform cron.unschedule('nightly-clear-completed-projects');
exception when others then null;
end $$;

-- Drop check + index then the column itself.
alter table public.projects drop constraint if exists projects_category_check;
drop index if exists idx_projects_category;
alter table public.projects drop column if exists category;
