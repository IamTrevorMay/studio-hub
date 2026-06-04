-- Migrate Ad Read Pipeline and Mayday Video workflows to kanban boards.
-- Cleans up column titles for board display, populates default_assignee_ids
-- from the old assignee_value, and adds a terminal "Complete" column to each.

BEGIN;

-- ============================================================
-- Ad Read Pipeline
-- ============================================================
DO $$
DECLARE
  wf_id uuid;
BEGIN
  SELECT id INTO wf_id FROM public.workflows WHERE slug = 'ad_read_workflow';
  IF wf_id IS NULL THEN
    RAISE NOTICE 'ad_read_workflow not found — skipping';
    RETURN;
  END IF;

  -- Clean column titles (remove template variables)
  UPDATE public.workflow_steps SET title_template = 'Review Proposal'
    WHERE workflow_id = wf_id AND step_key = 'review_proposal';
  UPDATE public.workflow_steps SET title_template = 'Collect Brief'
    WHERE workflow_id = wf_id AND step_key = 'collect_brief';
  UPDATE public.workflow_steps SET title_template = 'Write Ad Reads'
    WHERE workflow_id = wf_id AND step_key = 'write_ad_reads';
  UPDATE public.workflow_steps SET title_template = 'Connect to Video'
    WHERE workflow_id = wf_id AND step_key = 'connect_to_video';

  -- Copy assignee_value → default_assignee_ids where set
  UPDATE public.workflow_steps
    SET default_assignee_ids = ARRAY[assignee_value::uuid]
    WHERE workflow_id = wf_id
      AND assignee_value IS NOT NULL
      AND assignee_value != ''
      AND default_assignee_ids = '{}'::uuid[];

  -- Un-terminal the last working step (connect_to_video)
  UPDATE public.workflow_steps
    SET is_terminal = false
    WHERE workflow_id = wf_id AND step_key = 'connect_to_video';

  -- Add "Complete" terminal column
  INSERT INTO public.workflow_steps (
    workflow_id, step_key, title_template,
    position, entry_action_type, is_terminal, default_assignee_ids
  ) VALUES (
    wf_id, 'kanban_complete', 'Complete',
    9999, 'create_task', true, '{}'::uuid[]
  );
END $$;

-- ============================================================
-- Mayday Video Workflow
-- ============================================================
DO $$
DECLARE
  wf_id uuid;
BEGIN
  SELECT id INTO wf_id FROM public.workflows WHERE slug = 'mayday_video_workflow';
  IF wf_id IS NULL THEN
    RAISE NOTICE 'mayday_video_workflow not found — skipping';
    RETURN;
  END IF;

  -- Clean column titles
  UPDATE public.workflow_steps SET title_template = 'Pre-Production'
    WHERE workflow_id = wf_id AND step_key = 'pre_production';
  UPDATE public.workflow_steps SET title_template = 'Filming Prep'
    WHERE workflow_id = wf_id AND step_key = 'filming_prep';
  UPDATE public.workflow_steps SET title_template = 'Film & Send to Editor'
    WHERE workflow_id = wf_id AND step_key = 'film_send_to_editor';
  UPDATE public.workflow_steps SET title_template = 'Wait on Edit'
    WHERE workflow_id = wf_id AND step_key = 'wait_on_edit';
  UPDATE public.workflow_steps SET title_template = 'Thumbnail & Schedule'
    WHERE workflow_id = wf_id AND step_key = 'thumbnail_schedule';

  -- Un-terminal the last working step (thumbnail_schedule)
  UPDATE public.workflow_steps
    SET is_terminal = false
    WHERE workflow_id = wf_id AND step_key = 'thumbnail_schedule';

  -- Add "Complete" terminal column
  INSERT INTO public.workflow_steps (
    workflow_id, step_key, title_template,
    position, entry_action_type, is_terminal, default_assignee_ids
  ) VALUES (
    wf_id, 'kanban_complete', 'Complete',
    9999, 'create_task', true, '{}'::uuid[]
  );

  -- Ensure is_active (may have been deactivated)
  UPDATE public.workflows SET is_active = true WHERE id = wf_id;
END $$;

-- Also ensure ad_read_workflow is active
UPDATE public.workflows SET is_active = true WHERE slug = 'ad_read_workflow';

COMMIT;
