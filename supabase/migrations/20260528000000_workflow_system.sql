-- Workflow system: Phase 1 schema
-- Tables: workflows, workflow_instances, tasks, task_events

-- ============================================================
-- 1. workflows — template definitions (seeded in code)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.workflows (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text,
  slug        text UNIQUE NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.workflows ENABLE ROW LEVEL SECURITY;

-- Admins can read all workflows
CREATE POLICY workflows_admin_read ON public.workflows
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- All authenticated users can read active workflows
CREATE POLICY workflows_active_read ON public.workflows
  FOR SELECT TO authenticated
  USING (is_active = true);

-- ============================================================
-- 2. workflow_instances — running instances of a workflow
-- ============================================================
CREATE TABLE IF NOT EXISTS public.workflow_instances (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id   uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'complete', 'cancelled')),
  context       jsonb NOT NULL DEFAULT '{}',
  started_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  started_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz
);

CREATE INDEX idx_workflow_instances_workflow ON public.workflow_instances(workflow_id);
CREATE INDEX idx_workflow_instances_status ON public.workflow_instances(status);

ALTER TABLE public.workflow_instances ENABLE ROW LEVEL SECURITY;

-- Admins can read all instances
CREATE POLICY wf_instances_admin_read ON public.workflow_instances
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- NOTE: wf_instances_participant_read policy created after tasks table (forward reference)

-- ============================================================
-- 3. tasks — individual steps within a workflow instance
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tasks (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_instance_id    uuid NOT NULL REFERENCES public.workflow_instances(id) ON DELETE CASCADE,
  step_key                text NOT NULL,
  title                   text NOT NULL,
  description             text,
  assignee_id             uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  status                  text NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'active', 'on_hold', 'complete', 'skipped')),
  related_entity_type     text,
  related_entity_id       uuid,
  hold_reason             text,
  completion_payload      jsonb,
  position                integer NOT NULL DEFAULT 0,
  depends_on              uuid[] NOT NULL DEFAULT '{}',
  snoozed_until           timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  completed_at            timestamptz
);

CREATE INDEX idx_tasks_assignee_status ON public.tasks(assignee_id, status);
CREATE INDEX idx_tasks_instance_status ON public.tasks(workflow_instance_id, status);
CREATE INDEX idx_tasks_snoozed ON public.tasks(snoozed_until) WHERE snoozed_until IS NOT NULL;

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

-- Admins can read all tasks
CREATE POLICY tasks_admin_read ON public.tasks
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Users can read their own tasks
CREATE POLICY tasks_own_read ON public.tasks
  FOR SELECT TO authenticated
  USING (assignee_id = auth.uid());

-- Deferred RLS policy: users can read instances they participate in
CREATE POLICY wf_instances_participant_read ON public.workflow_instances
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tasks
      WHERE tasks.workflow_instance_id = workflow_instances.id
        AND tasks.assignee_id = auth.uid()
    )
  );

-- ============================================================
-- 4. task_events — audit trail
-- ============================================================
CREATE TABLE IF NOT EXISTS public.task_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  event_type  text NOT NULL
              CHECK (event_type IN ('created', 'completed', 'held', 'resumed', 'reassigned', 'snoozed', 'skipped')),
  actor_id    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  payload     jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_task_events_task ON public.task_events(task_id, created_at);

ALTER TABLE public.task_events ENABLE ROW LEVEL SECURITY;

-- Admins can read all events
CREATE POLICY task_events_admin_read ON public.task_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Users can read events for their own tasks
CREATE POLICY task_events_own_read ON public.task_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tasks
      WHERE tasks.id = task_events.task_id
        AND tasks.assignee_id = auth.uid()
    )
  );

-- ============================================================
-- 5. Grant service_role full access for edge functions
-- ============================================================
GRANT ALL ON public.workflows TO service_role;
GRANT ALL ON public.workflow_instances TO service_role;
GRANT ALL ON public.tasks TO service_role;
GRANT ALL ON public.task_events TO service_role;

-- ============================================================
-- 6. Enable Realtime for tasks (My Tasks live updates)
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
