-- Restore cancelled workflow instances as kanban cards.
-- The 20260603210000 migration cancelled all active instances and skipped their
-- tasks. This migration reactivates instances for ad_read_workflow and
-- mayday_video_workflow, placing each card in the column matching its most
-- advanced task, and derives a card title from the instance context.

BEGIN;

-- 1. Set current_step_key + title on each cancelled instance based on its
--    most advanced task (highest position = furthest column reached).
UPDATE public.workflow_instances wi
SET
  status = 'active',
  completed_at = NULL,
  current_step_key = sub.step_key,
  title = COALESCE(
    wi.title,
    wi.context->>'brand_name',
    wi.context->>'sponsor_name',
    wi.context->>'beat_sheet_title',
    wi.context->>'title',
    wi.context->>'file_name',
    'Untitled'
  )
FROM (
  SELECT DISTINCT ON (t.workflow_instance_id)
    t.workflow_instance_id,
    t.step_key
  FROM public.tasks t
  JOIN public.workflow_instances i ON i.id = t.workflow_instance_id
  JOIN public.workflows w ON w.id = i.workflow_id
  WHERE w.slug IN ('ad_read_workflow', 'mayday_video_workflow')
    AND i.status = 'cancelled'
  ORDER BY t.workflow_instance_id, t.position DESC
) sub
WHERE wi.id = sub.workflow_instance_id;

-- 2. For restored instances, verify the current_step_key actually exists as
--    a column in the workflow. If not (e.g. old step_key doesn't match new
--    kanban columns), fall back to the first non-terminal column.
UPDATE public.workflow_instances wi
SET current_step_key = first_col.step_key
FROM (
  SELECT DISTINCT ON (ws.workflow_id) ws.workflow_id, ws.step_key
  FROM public.workflow_steps ws
  WHERE ws.is_terminal = false
  ORDER BY ws.workflow_id, ws.position ASC
) first_col
WHERE wi.workflow_id = first_col.workflow_id
  AND wi.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM public.workflow_steps ws
    WHERE ws.workflow_id = wi.workflow_id
      AND ws.step_key = wi.current_step_key
  );

-- 3. Reactivate the most recent task for each restored instance so it shows
--    in My Tasks. Only reactivate tasks whose step_key matches a valid column.
UPDATE public.tasks t
SET status = 'active', completed_at = NULL
FROM (
  SELECT DISTINCT ON (t2.workflow_instance_id)
    t2.id
  FROM public.tasks t2
  JOIN public.workflow_instances i ON i.id = t2.workflow_instance_id
  WHERE i.status = 'active'
    AND t2.status = 'skipped'
    AND t2.step_key = i.current_step_key
  ORDER BY t2.workflow_instance_id, t2.position DESC
) sub
WHERE t.id = sub.id;

COMMIT;
