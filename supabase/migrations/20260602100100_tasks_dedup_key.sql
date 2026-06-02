-- Add an explicit dedup_key column to tasks so run-automations can do an
-- exact-match check instead of `ilike('%key%')` on the title (which never
-- matches and lets every fire create duplicate tasks).

alter table public.tasks
  add column if not exists dedup_key text;

create index if not exists idx_tasks_automation_dedup_key
  on public.tasks (automation_id, dedup_key)
  where automation_id is not null
    and dedup_key is not null
    and status = 'active';
