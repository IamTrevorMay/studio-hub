-- Migrate ad_read_workflow to data-driven format
-- Keeps the code-based definition as fallback for running instances

-- ============================================================
-- 1. Update the workflows row: set source='data', add metadata
-- ============================================================
UPDATE public.workflows
SET
  source = 'data',
  first_step_key = 'review_proposal',
  trigger_mode = 'auto',
  trigger_config = '{"entity": "ad_read_proposals", "event": "insert"}'::jsonb
WHERE slug = 'ad_read_workflow';

-- ============================================================
-- 2. Insert workflow_steps for ad_read_workflow
-- ============================================================
DO $$
DECLARE
  wf_id uuid;
  step_review_id uuid;
  step_brief_id uuid;
  step_write_id uuid;
  step_connect_id uuid;
  ver_id uuid;
BEGIN
  SELECT id INTO wf_id FROM public.workflows WHERE slug = 'ad_read_workflow';
  IF wf_id IS NULL THEN
    RAISE EXCEPTION 'ad_read_workflow not found';
  END IF;

  -- Step 1: review_proposal
  INSERT INTO public.workflow_steps (
    workflow_id, step_key, title_template, description_template,
    assignee_type, assignee_value,
    action_type, action_label, action_config,
    on_complete_handler, position
  ) VALUES (
    wf_id, 'review_proposal',
    'Review proposal: {{brand_name}}',
    'Review and accept or deny the ad read proposal from {{brand_name}}.',
    'static', 'c3290048-436b-46c6-b3f0-fdf7923d0c3b',
    'custom', 'Review Proposal', '{}',
    'ad_read:review_proposal', 0
  ) RETURNING id INTO step_review_id;

  -- Step 2: collect_brief
  INSERT INTO public.workflow_steps (
    workflow_id, step_key, title_template, description_template,
    assignee_type, assignee_value,
    related_entity_type, related_entity_context_key,
    action_type, action_label, action_config,
    position
  ) VALUES (
    wf_id, 'collect_brief',
    'Collect brief: {{brand_name}}',
    'Get the creative brief from {{brand_name}} and attach it to the campaign.',
    'static', '712f6910-7262-4551-8cb4-9dc609ef91fb',
    'campaign', 'campaign_id',
    'navigate', 'Go to Deliverables', '{"tab": "deliverables"}',
    1
  ) RETURNING id INTO step_brief_id;

  -- Step 3: write_ad_reads (fan-out)
  INSERT INTO public.workflow_steps (
    workflow_id, step_key, title_template,
    assignee_type, assignee_value,
    fan_out_context_key, fan_out_title_template,
    fan_out_entity_type, fan_out_entity_id_key,
    action_type, action_label, action_config,
    position
  ) VALUES (
    wf_id, 'write_ad_reads',
    'Write ad read: {{title}}',
    'static', '7b1e50e0-cede-409d-a160-1aa6d1e232a9',
    'deliverables', 'Write ad read: {{title}}',
    'deliverable', 'deliverable_id',
    'complete', 'Mark Complete', '{}',
    2
  ) RETURNING id INTO step_write_id;

  -- Step 4: connect_to_video (fan-out + fan-in on write_ad_reads)
  INSERT INTO public.workflow_steps (
    workflow_id, step_key, title_template,
    assignee_type, assignee_value,
    fan_out_context_key, fan_out_title_template,
    fan_out_entity_type, fan_out_entity_id_key,
    depends_on_step_keys,
    on_complete_handler,
    action_type, action_label, action_config,
    position
  ) VALUES (
    wf_id, 'connect_to_video',
    'Connect to video: {{title}}',
    'static', 'c3290048-436b-46c6-b3f0-fdf7923d0c3b',
    'deliverables', 'Connect to video: {{title}}',
    'deliverable', 'deliverable_id',
    ARRAY['write_ad_reads'],
    'ad_read:set_video_event',
    'custom', 'Connect Video', '{}',
    3
  ) RETURNING id INTO step_connect_id;

  -- ============================================================
  -- 3. Insert outcomes for review_proposal (branching step)
  -- ============================================================
  INSERT INTO public.workflow_step_outcomes (step_id, outcome_key, label, next_step_key, style, position)
  VALUES
    (step_review_id, 'accept', 'Accept', 'collect_brief', 'success', 0),
    (step_review_id, 'deny', 'Deny', NULL, 'danger', 1);

  -- Outcomes for non-branching steps (single "complete" outcome)
  INSERT INTO public.workflow_step_outcomes (step_id, outcome_key, label, next_step_key, style, position)
  VALUES
    (step_brief_id, 'complete', 'Complete', 'write_ad_reads', 'default', 0),
    (step_write_id, 'complete', 'Complete', 'connect_to_video', 'default', 0),
    (step_connect_id, 'complete', 'Complete', NULL, 'default', 0);

  -- ============================================================
  -- 4. Create initial version snapshot (v1)
  -- ============================================================
  INSERT INTO public.workflow_versions (workflow_id, version_number, snapshot, published_at)
  VALUES (
    wf_id, 1,
    jsonb_build_object(
      'firstStep', 'review_proposal',
      'steps', (
        SELECT jsonb_agg(row_to_json(s.*) ORDER BY s.position)
        FROM public.workflow_steps s WHERE s.workflow_id = wf_id
      ),
      'outcomes', (
        SELECT jsonb_agg(row_to_json(o.*))
        FROM public.workflow_step_outcomes o
        INNER JOIN public.workflow_steps s ON s.id = o.step_id
        WHERE s.workflow_id = wf_id
      )
    ),
    now()
  )
  RETURNING id INTO ver_id;

  -- ============================================================
  -- 5. Set current_version_id on the workflow
  -- ============================================================
  UPDATE public.workflows
  SET current_version_id = ver_id
  WHERE id = wf_id;
END $$;
