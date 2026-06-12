-- Bridge tasks → personal_tasks so project-stage and automation tasks
-- appear in the assignee's My Tasks board.

-- 1. Add task_id FK column
ALTER TABLE public.personal_tasks
  ADD COLUMN IF NOT EXISTS task_id uuid REFERENCES public.tasks(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS personal_tasks_task_id_idx
  ON public.personal_tasks(task_id) WHERE task_id IS NOT NULL;

-- 2. Trigger: auto-create personal_tasks row when a task is inserted
CREATE OR REPLACE FUNCTION public.bridge_task_to_personal_task()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.assignee_id IS NOT NULL THEN
    INSERT INTO public.personal_tasks (created_by, content, status, category, due_date, position, task_id)
    VALUES (
      NEW.assignee_id,
      NEW.title,
      'inbox',
      'production',
      NEW.due_date,
      0,
      NEW.id
    )
    ON CONFLICT (task_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bridge_task_insert ON public.tasks;
CREATE TRIGGER trg_bridge_task_insert
  AFTER INSERT ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.bridge_task_to_personal_task();

-- 3. Trigger: cascade status changes from tasks → personal_tasks
CREATE OR REPLACE FUNCTION public.bridge_task_status_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.status IN ('complete', 'skipped', 'declined')
     AND OLD.status NOT IN ('complete', 'skipped', 'declined') THEN
    UPDATE public.personal_tasks
    SET status = 'done', completed_at = now()
    WHERE task_id = NEW.id AND status <> 'done';
  ELSIF NEW.status NOT IN ('complete', 'skipped', 'declined')
        AND OLD.status IN ('complete', 'skipped', 'declined') THEN
    UPDATE public.personal_tasks
    SET status = 'ready', completed_at = NULL
    WHERE task_id = NEW.id AND status = 'done';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bridge_task_status ON public.tasks;
CREATE TRIGGER trg_bridge_task_status
  AFTER UPDATE OF status ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.bridge_task_status_sync();

-- 4. Backfill existing open tasks
INSERT INTO public.personal_tasks (created_by, content, status, category, due_date, position, task_id)
SELECT
  t.assignee_id,
  t.title,
  'inbox',
  'production',
  t.due_date,
  0,
  t.id
FROM public.tasks t
WHERE t.assignee_id IS NOT NULL
  AND t.status IN ('pending', 'active', 'on_hold')
  AND NOT EXISTS (
    SELECT 1 FROM public.personal_tasks pt WHERE pt.task_id = t.id
  );
