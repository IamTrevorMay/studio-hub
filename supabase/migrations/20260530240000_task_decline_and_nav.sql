-- Let assignees decline a task, and let a direct task carry a "Do it" target
-- page so its My Tasks card gets a button that navigates straight there.

-- 'declined' as a terminal task status
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_status_check
  CHECK (status IN ('pending', 'active', 'on_hold', 'complete', 'skipped', 'declined'));

-- 'declined' as an auditable event
ALTER TABLE public.task_events DROP CONSTRAINT IF EXISTS task_events_event_type_check;
ALTER TABLE public.task_events ADD CONSTRAINT task_events_event_type_check
  CHECK (event_type IN ('created', 'completed', 'held', 'resumed', 'reassigned', 'snoozed', 'skipped', 'declined'));

-- "Do it" navigation target (an in-app page/tab key) for direct tasks
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS nav_target text;
