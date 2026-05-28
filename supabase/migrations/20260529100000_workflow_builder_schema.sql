-- Workflow Builder Schema: data-driven step definitions, outcomes, versions
-- Phase 3A-1

-- ============================================================
-- 1. workflow_steps: data-driven step definitions
-- ============================================================
CREATE TABLE public.workflow_steps (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id               uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  step_key                  text NOT NULL,
  title_template            text NOT NULL,
  description_template      text,
  assignee_type             text NOT NULL DEFAULT 'static'
                            CHECK (assignee_type IN ('static', 'context')),
  assignee_value            text,
  related_entity_type       text,
  related_entity_context_key text,
  action_type               text NOT NULL DEFAULT 'complete'
                            CHECK (action_type IN ('complete', 'navigate', 'modal', 'custom')),
  action_label              text NOT NULL DEFAULT 'Mark Complete',
  action_config             jsonb DEFAULT '{}',
  fan_out_context_key       text,
  fan_out_title_template    text,
  fan_out_entity_type       text,
  fan_out_entity_id_key     text,
  depends_on_step_keys      text[] DEFAULT '{}',
  condition_expression      text,
  on_complete_handler       text,
  position                  integer NOT NULL DEFAULT 0,
  created_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workflow_id, step_key)
);

-- ============================================================
-- 2. workflow_step_outcomes: branching support
-- ============================================================
CREATE TABLE public.workflow_step_outcomes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  step_id         uuid NOT NULL REFERENCES public.workflow_steps(id) ON DELETE CASCADE,
  outcome_key     text NOT NULL,
  label           text NOT NULL,
  next_step_key   text,
  style           text DEFAULT 'default'
                  CHECK (style IN ('default', 'success', 'danger', 'warning')),
  position        integer NOT NULL DEFAULT 0,
  UNIQUE(step_id, outcome_key)
);

-- ============================================================
-- 3. workflow_versions: immutable snapshots for running instances
-- ============================================================
CREATE TABLE public.workflow_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id     uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  version_number  integer NOT NULL,
  snapshot        jsonb NOT NULL,
  published_by    uuid REFERENCES public.profiles(id),
  published_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workflow_id, version_number)
);

-- ============================================================
-- 4. Alter workflows table: add builder columns
-- ============================================================
ALTER TABLE public.workflows
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'code'
    CHECK (source IN ('code', 'data')),
  ADD COLUMN IF NOT EXISTS first_step_key text,
  ADD COLUMN IF NOT EXISTS trigger_mode text DEFAULT 'manual'
    CHECK (trigger_mode IN ('manual', 'auto', 'both')),
  ADD COLUMN IF NOT EXISTS trigger_config jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS current_version_id uuid
    REFERENCES public.workflow_versions(id);

-- ============================================================
-- 5. Alter workflow_instances: pin to version + test_mode
-- ============================================================
ALTER TABLE public.workflow_instances
  ADD COLUMN IF NOT EXISTS version_id uuid
    REFERENCES public.workflow_versions(id),
  ADD COLUMN IF NOT EXISTS test_mode boolean NOT NULL DEFAULT false;

-- ============================================================
-- 6. RLS policies: admin-only on all new tables
-- ============================================================
ALTER TABLE public.workflow_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_step_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_versions ENABLE ROW LEVEL SECURITY;

-- workflow_steps
CREATE POLICY "Admin read workflow_steps"
  ON public.workflow_steps FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

CREATE POLICY "Admin insert workflow_steps"
  ON public.workflow_steps FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

CREATE POLICY "Admin update workflow_steps"
  ON public.workflow_steps FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

CREATE POLICY "Admin delete workflow_steps"
  ON public.workflow_steps FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

-- workflow_step_outcomes
CREATE POLICY "Admin read workflow_step_outcomes"
  ON public.workflow_step_outcomes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

CREATE POLICY "Admin insert workflow_step_outcomes"
  ON public.workflow_step_outcomes FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

CREATE POLICY "Admin update workflow_step_outcomes"
  ON public.workflow_step_outcomes FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

CREATE POLICY "Admin delete workflow_step_outcomes"
  ON public.workflow_step_outcomes FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

-- workflow_versions
CREATE POLICY "Admin read workflow_versions"
  ON public.workflow_versions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

CREATE POLICY "Admin insert workflow_versions"
  ON public.workflow_versions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

-- ============================================================
-- 7. Service role grants
-- ============================================================
GRANT ALL ON public.workflow_steps TO service_role;
GRANT ALL ON public.workflow_step_outcomes TO service_role;
GRANT ALL ON public.workflow_versions TO service_role;

-- ============================================================
-- 8. Enable realtime on workflow_steps for builder live updates
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.workflow_steps;
