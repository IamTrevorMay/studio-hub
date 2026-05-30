-- Direct (one-off) task assignments. A direct task is a `tasks` row with no
-- workflow behind it, so it shows up in the assignee's My Tasks alongside
-- workflow tasks and reuses the same complete/hold/snooze plumbing.

-- Allow tasks that aren't tied to a workflow instance.
ALTER TABLE public.tasks
  ALTER COLUMN workflow_instance_id DROP NOT NULL;

-- Fields a direct task can carry (null/unused for workflow tasks).
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS due_date   timestamptz,
  ADD COLUMN IF NOT EXISTS link_url   text,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Helps the Assignments people-grid pull recently-completed tasks per person.
CREATE INDEX IF NOT EXISTS idx_tasks_assignee_completed
  ON public.tasks (assignee_id, completed_at)
  WHERE status = 'complete';
