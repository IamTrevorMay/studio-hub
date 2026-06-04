-- Workflow Kanban v2: task-driven sign-off pipeline.
-- Cards move through columns automatically when all assignees sign off.
-- New tables: task_sign_offs, workflow_card_audit.
-- Alters: workflow_steps (entry_action_type, is_terminal), tasks (requires_sign_off).

BEGIN;

-- ============================================================
-- 1. task_sign_offs — per-user sign-off tracking on shared tasks
-- ============================================================
CREATE TABLE public.task_sign_offs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id       uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  signed_off_at timestamptz,  -- null = pending, non-null = done
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, user_id)
);

CREATE INDEX idx_task_sign_offs_task ON public.task_sign_offs(task_id);
CREATE INDEX idx_task_sign_offs_user_pending
  ON public.task_sign_offs(user_id)
  WHERE signed_off_at IS NULL;

ALTER TABLE public.task_sign_offs ENABLE ROW LEVEL SECURITY;

-- Admins full access
CREATE POLICY "admin_all_task_sign_offs" ON public.task_sign_offs
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Users can read their own sign-offs
CREATE POLICY "own_read_task_sign_offs" ON public.task_sign_offs
  FOR SELECT USING (user_id = auth.uid());

-- Users can update their own sign-offs (to set signed_off_at)
CREATE POLICY "own_update_task_sign_offs" ON public.task_sign_offs
  FOR UPDATE USING (user_id = auth.uid());

GRANT ALL ON public.task_sign_offs TO service_role;

-- ============================================================
-- 2. workflow_card_audit — audit trail for card-level changes
-- ============================================================
CREATE TABLE public.workflow_card_audit (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id     uuid NOT NULL REFERENCES public.workflow_instances(id) ON DELETE CASCADE,
  change_type     text NOT NULL,         -- 'assignee_changed'
  column_step_key text,
  old_value       jsonb DEFAULT '{}'::jsonb,
  new_value       jsonb DEFAULT '{}'::jsonb,
  changed_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_wf_card_audit_instance ON public.workflow_card_audit(instance_id);

ALTER TABLE public.workflow_card_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_all_wf_card_audit" ON public.workflow_card_audit
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

GRANT ALL ON public.workflow_card_audit TO service_role;

-- ============================================================
-- 3. Alter workflow_steps — entry_action_type + is_terminal
-- ============================================================
ALTER TABLE public.workflow_steps
  ADD COLUMN IF NOT EXISTS entry_action_type text NOT NULL DEFAULT 'create_task'
    CHECK (entry_action_type IN ('create_task'));

ALTER TABLE public.workflow_steps
  ADD COLUMN IF NOT EXISTS is_terminal boolean NOT NULL DEFAULT false;

-- ============================================================
-- 4. Alter tasks — requires_sign_off flag
-- ============================================================
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS requires_sign_off boolean NOT NULL DEFAULT false;

-- ============================================================
-- 5. Extend task_events CHECK to include 'signed_off'
-- ============================================================
ALTER TABLE public.task_events
  DROP CONSTRAINT IF EXISTS task_events_event_type_check;
ALTER TABLE public.task_events
  ADD CONSTRAINT task_events_event_type_check
  CHECK (event_type IN (
    'created','completed','held','resumed','reassigned',
    'snoozed','skipped','declined','signed_off'
  ));

-- ============================================================
-- 6. Migrate existing data
-- ============================================================

-- Mark last column of each workflow as terminal
UPDATE public.workflow_steps ws
SET is_terminal = true
WHERE ws.position = (
  SELECT max(ws2.position)
  FROM public.workflow_steps ws2
  WHERE ws2.workflow_id = ws.workflow_id
);

-- ============================================================
-- 7. Cron: archive completed cards Sunday 9 PM PT (Mon 04:00 UTC)
-- ============================================================
SELECT cron.schedule(
  'archive-complete-workflow-cards',
  '0 4 * * 1',
  $$
    UPDATE public.workflow_instances
    SET status = 'cancelled',
        completed_at = COALESCE(completed_at, now())
    WHERE status = 'complete'
      AND completed_at < now() - interval '1 hour';
  $$
);

-- ============================================================
-- 8. Enable realtime on task_sign_offs for live progress
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.task_sign_offs;

COMMIT;
