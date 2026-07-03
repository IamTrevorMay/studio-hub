-- Workflows Kanban refactor.
-- Each workflow = a Kanban board. workflow_steps now means "column".
-- workflow_instances = card. Cards move through columns. Tasks generated
-- per-assignee when card enters a column.
--
-- Migration:
--   1. Add card-level fields to workflow_instances (title, current_step_key, assignee_overrides).
--   2. Add column-level default_assignee_ids to workflow_steps.
--   3. Extend workflow_instances.status to allow 'blocked' (empty-column halt).
--   4. Cancel all in-flight code-source instances + skip their tasks.
--   5. Deactivate code-source workflows so they no longer trigger.

BEGIN;

-- 1. Card fields on workflow_instances.
ALTER TABLE public.workflow_instances
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS current_step_key text,
  ADD COLUMN IF NOT EXISTS assignee_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Allow 'blocked' status (card halted in empty column).
ALTER TABLE public.workflow_instances
  DROP CONSTRAINT IF EXISTS workflow_instances_status_check;
ALTER TABLE public.workflow_instances
  ADD CONSTRAINT workflow_instances_status_check
  CHECK (status IN ('active', 'complete', 'cancelled', 'blocked'));

-- 2. Column default assignees on workflow_steps.
ALTER TABLE public.workflow_steps
  ADD COLUMN IF NOT EXISTS default_assignee_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

-- 3. Cancel mid-flight instances + skip their open tasks (clean slate).
UPDATE public.tasks
  SET status = 'skipped',
      completed_at = COALESCE(completed_at, now())
  WHERE workflow_instance_id IS NOT NULL
    AND status IN ('pending', 'active', 'on_hold');

UPDATE public.workflow_instances
  SET status = 'cancelled',
      completed_at = COALESCE(completed_at, now())
  WHERE status = 'active';

-- 4. Deactivate code-source workflows. They're replaced by the kanban model;
--    the new UI re-activates them once columns + assignees are configured.
UPDATE public.workflows
  SET is_active = false
  WHERE source = 'code';

COMMIT;
