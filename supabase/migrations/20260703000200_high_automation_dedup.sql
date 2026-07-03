-- HIGH fix: concurrency safety for the automation engine.
--
-- (1) automation_runs gains a 'running' status so approve-automation can claim a
--     pending confirmation atomically (UPDATE ... WHERE status='pending_confirmation'
--     RETURNING) before executing actions — two admins approving the same
--     all_admins gate no longer both execute.
--
-- (2) A unique index on tasks(automation_id, dedup_key, assignee_id) makes task
--     creation idempotent: run-automations and approve-automation upsert with
--     ignoreDuplicates, so a concurrent/retried trigger can't fan out duplicate
--     tasks. NULLs are distinct in Postgres unique indexes, so the many existing
--     rows with null automation_id/dedup_key are unaffected (verified 0 collisions
--     among non-null triples before adding this).

alter table public.automation_runs
  drop constraint if exists automation_runs_status_check;
alter table public.automation_runs
  add constraint automation_runs_status_check
  check (status = any (array['success','skipped','error','pending_confirmation','running']));

create unique index if not exists tasks_automation_dedup_uidx
  on public.tasks (automation_id, dedup_key, assignee_id);
