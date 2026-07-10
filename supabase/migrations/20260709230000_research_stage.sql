-- Research stage for the project kanban (between Queue and Write).
-- Podcast and short-form projects skip it by default; backfill existing
-- projects' stage_config to match the new TYPE_DEFAULT_SKIPS.
-- No schema change: projects.status has no check constraint, and the
-- 'research' / 'research_scope' task step_keys are plain text.

UPDATE public.projects
   SET stage_config = coalesce(stage_config, '{}'::jsonb)
       || jsonb_build_object('research', jsonb_build_object('skip', true))
 WHERE type IN ('podcast', 'short_form')
   AND coalesce(stage_config->'research'->>'skip', 'false') <> 'true';
