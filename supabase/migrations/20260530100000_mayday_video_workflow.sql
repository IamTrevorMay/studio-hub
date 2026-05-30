-- Mayday Video Workflow: 5 sequential steps, kicked off when a beat sheet
-- lands in the Mayday folder. Steps 1, 2, 5 require an in-app confirm
-- before completing. Step 3 uses an inline editor picker and auto-completes
-- when a matching freelancer_assignment is created. Step 4 auto-completes
-- when that assignment is marked completed.

INSERT INTO public.workflows (name, description, slug, source, first_step_key, trigger_mode, trigger_config, is_active)
VALUES (
  'Mayday Video Workflow',
  'Per-video pipeline kicked off when a beat sheet is placed in the Mayday folder.',
  'mayday_video_workflow',
  'data',
  'pre_production',
  'auto',
  '{"entity": "beat_sheets", "event": "insert_or_move_into_mayday"}'::jsonb,
  true
)
ON CONFLICT (slug) DO NOTHING;

DO $$
DECLARE
  wf_id uuid;
  step_pre_id uuid;
  step_prep_id uuid;
  step_film_id uuid;
  step_wait_id uuid;
  step_thumb_id uuid;
  ver_id uuid;
BEGIN
  SELECT id INTO wf_id FROM public.workflows WHERE slug = 'mayday_video_workflow';
  IF wf_id IS NULL THEN
    RAISE EXCEPTION 'mayday_video_workflow not seeded';
  END IF;

  -- Step 1: Pre-production (confirm-on-complete)
  INSERT INTO public.workflow_steps (
    workflow_id, step_key, title_template, description_template,
    assignee_type, assignee_value,
    action_type, action_label, action_config,
    position
  ) VALUES (
    wf_id, 'pre_production',
    'Mayday Video Pre-Production: {{beat_sheet_title}}',
    'Complete beat sheet & update Broadcast.',
    'static', '',
    'complete', 'Complete', '{"confirm": true}'::jsonb,
    0
  ) RETURNING id INTO step_pre_id;

  -- Step 2: Filming prep (confirm-on-complete)
  INSERT INTO public.workflow_steps (
    workflow_id, step_key, title_template, description_template,
    assignee_type, assignee_value,
    action_type, action_label, action_config,
    position
  ) VALUES (
    wf_id, 'filming_prep',
    'Complete Mayday Filming Prep: {{beat_sheet_title}}',
    'Finalize beat sheet & push script to teleprompter.',
    'static', '',
    'complete', 'Complete', '{"confirm": true}'::jsonb,
    1
  ) RETURNING id INTO step_prep_id;

  -- Step 3: Film & send (inline editor picker, auto-complete via assignment trigger)
  INSERT INTO public.workflow_steps (
    workflow_id, step_key, title_template, description_template,
    assignee_type, assignee_value,
    action_type, action_label, action_config,
    on_complete_handler, position
  ) VALUES (
    wf_id, 'film_send_to_editor',
    'Film Video & Send to Editor: {{beat_sheet_title}}',
    'Pick the editor. Task auto-completes when their Contractors assignment is created.',
    'static', '',
    'custom', 'Waiting for assignment',
    '{"inline_editor_picker": true, "context_key": "editor_id", "auto_complete_on_assignment": true}'::jsonb,
    'mayday:film_send_handoff', 2
  ) RETURNING id INTO step_film_id;

  -- Step 4: Wait on edit (auto-complete when assignment marked completed)
  INSERT INTO public.workflow_steps (
    workflow_id, step_key, title_template, description_template,
    assignee_type, assignee_value,
    action_type, action_label, action_config,
    position
  ) VALUES (
    wf_id, 'wait_on_edit',
    'Wait on Edit: {{beat_sheet_title}}',
    'Auto-completes when the editor marks their assignment complete.',
    'static', '',
    'custom', 'Waiting on editor',
    '{"auto_complete_on_assignment_done": true, "context_key": "editor_assignment_id"}'::jsonb,
    3
  ) RETURNING id INTO step_wait_id;

  -- Step 5: Thumbnail & schedule (confirm-on-complete)
  INSERT INTO public.workflow_steps (
    workflow_id, step_key, title_template, description_template,
    assignee_type, assignee_value,
    action_type, action_label, action_config,
    position
  ) VALUES (
    wf_id, 'thumbnail_schedule',
    'Create Thumbnail & Schedule: {{beat_sheet_title}}',
    'Build the thumbnail, schedule the upload, close out the workflow.',
    'static', '',
    'complete', 'Complete', '{"confirm": true}'::jsonb,
    4
  ) RETURNING id INTO step_thumb_id;

  -- Linear outcomes
  INSERT INTO public.workflow_step_outcomes (step_id, outcome_key, label, next_step_key, style, position) VALUES
    (step_pre_id,   'complete', 'Complete', 'filming_prep',        'default', 0),
    (step_prep_id,  'complete', 'Complete', 'film_send_to_editor', 'default', 0),
    (step_film_id,  'complete', 'Complete', 'wait_on_edit',        'default', 0),
    (step_wait_id,  'complete', 'Complete', 'thumbnail_schedule',  'default', 0),
    (step_thumb_id, 'complete', 'Complete', NULL,                  'default', 0);

  -- v1 snapshot, set as current
  INSERT INTO public.workflow_versions (workflow_id, version_number, snapshot, published_at)
  VALUES (
    wf_id, 1,
    jsonb_build_object(
      'firstStep', 'pre_production',
      'steps', (SELECT jsonb_agg(row_to_json(s.*) ORDER BY s.position) FROM public.workflow_steps s WHERE s.workflow_id = wf_id),
      'outcomes', (SELECT jsonb_agg(row_to_json(o.*)) FROM public.workflow_step_outcomes o INNER JOIN public.workflow_steps s ON s.id = o.step_id WHERE s.workflow_id = wf_id)
    ),
    now()
  )
  RETURNING id INTO ver_id;

  UPDATE public.workflows SET current_version_id = ver_id WHERE id = wf_id;
END $$;
