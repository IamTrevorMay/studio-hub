-- Builder-side display name for workflow steps. Distinct from step_key (machine
-- id) and title_template (the task title shown to assignees). Lets admins label
-- blocks in the Workflows builder to keep a flow straight.

ALTER TABLE public.workflow_steps
  ADD COLUMN IF NOT EXISTS name text;
