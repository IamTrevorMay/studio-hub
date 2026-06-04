-- Remove all workflows except Ad Read Pipeline and Mayday Video.
BEGIN;

-- Delete children first (FK constraints)
DELETE FROM public.workflow_instances
  WHERE workflow_id IN (
    SELECT id FROM public.workflows
    WHERE slug NOT IN ('ad_read_workflow', 'mayday_video_workflow')
  );

DELETE FROM public.workflow_steps
  WHERE workflow_id IN (
    SELECT id FROM public.workflows
    WHERE slug NOT IN ('ad_read_workflow', 'mayday_video_workflow')
  );

DELETE FROM public.workflow_versions
  WHERE workflow_id IN (
    SELECT id FROM public.workflows
    WHERE slug NOT IN ('ad_read_workflow', 'mayday_video_workflow')
  );

DELETE FROM public.workflows
  WHERE slug NOT IN ('ad_read_workflow', 'mayday_video_workflow');

COMMIT;
