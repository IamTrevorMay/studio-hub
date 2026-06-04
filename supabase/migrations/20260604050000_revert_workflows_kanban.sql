-- Revert the Kanban refactor's data-side effects only.
-- The kanban migration (20260603210000) deactivated source='code'
-- workflows and added new columns to workflow_instances / workflow_steps.
-- This revert re-enables the code workflows so the prior engine handles
-- them again. The added columns + 'blocked' status stay in place; they
-- are additive and harmless, and leaving them avoids data loss if the
-- kanban branch returns.

UPDATE public.workflows
SET is_active = true
WHERE source = 'code';
