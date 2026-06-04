-- Add admin write policies for workflows, workflow_instances, and tasks.
-- The kanban UI needs to create/update/delete boards, cards, and skip tasks.

-- ============================================================
-- workflows: admin full CRUD
-- ============================================================
CREATE POLICY workflows_admin_insert ON public.workflows
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY workflows_admin_update ON public.workflows
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY workflows_admin_delete ON public.workflows
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ============================================================
-- workflow_instances: admin full CRUD
-- ============================================================
CREATE POLICY wf_instances_admin_insert ON public.workflow_instances
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY wf_instances_admin_update ON public.workflow_instances
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY wf_instances_admin_delete ON public.workflow_instances
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ============================================================
-- tasks: admin update + delete (skip tasks on card delete, etc.)
-- ============================================================
CREATE POLICY tasks_admin_update ON public.tasks
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY tasks_admin_delete ON public.tasks
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );
