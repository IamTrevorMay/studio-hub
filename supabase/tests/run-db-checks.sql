-- Database Health Checks
-- Run via: cat supabase/tests/run-db-checks.sql | npx supabase db query --linked
-- Outputs a pass/fail table for structural integrity checks.

DO $$
DECLARE
  _pass int := 0;
  _fail int := 0;
  _results text[] := '{}';
  _exists boolean;
  _tbl text;
  _idx text;
  _fn text;
  _trg text;
  _job text;
BEGIN

  -- ═══════════════════════════════════════════════════════════════
  -- 1. Core tables exist
  -- ═══════════════════════════════════════════════════════════════
  FOREACH _tbl IN ARRAY ARRAY[
    'profiles', 'projects', 'bd_phases', 'bd_initiatives', 'bd_tasks',
    'bd_milestones', 'bd_initiative_links', 'personal_tasks', 'sprints',
    'sprint_goals', 'platform_accounts', 'content_items', 'research_feeds',
    'research_articles', 'research_trends', 'notifications', 'calendar_events',
    'mayday_videos', 'freelancer_profiles', 'freelancer_assignments',
    'nav_config', 'ingestion_logs'
  ] LOOP
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = _tbl
    ) INTO _exists;
    IF _exists THEN
      _pass := _pass + 1;
      _results := array_append(_results, 'PASS | table_exists | ' || _tbl);
    ELSE
      _fail := _fail + 1;
      _results := array_append(_results, 'FAIL | table_exists | ' || _tbl);
    END IF;
  END LOOP;

  -- ═══════════════════════════════════════════════════════════════
  -- 2. RLS enabled on security-critical tables
  -- ═══════════════════════════════════════════════════════════════
  FOREACH _tbl IN ARRAY ARRAY[
    'bd_phases', 'bd_initiatives', 'bd_tasks', 'bd_milestones',
    'profiles', 'personal_tasks', 'projects',
    'freelancer_profiles', 'freelancer_assignments'
  ] LOOP
    SELECT EXISTS (
      SELECT 1 FROM pg_tables
      WHERE schemaname = 'public' AND tablename = _tbl AND rowsecurity = true
    ) INTO _exists;
    IF _exists THEN
      _pass := _pass + 1;
      _results := array_append(_results, 'PASS | rls_enabled | ' || _tbl);
    ELSE
      _fail := _fail + 1;
      _results := array_append(_results, 'FAIL | rls_enabled | ' || _tbl);
    END IF;
  END LOOP;

  -- ═══════════════════════════════════════════════════════════════
  -- 3. Key indexes exist
  -- ═══════════════════════════════════════════════════════════════
  FOREACH _idx IN ARRAY ARRAY[
    'bd_tasks_due_date_idx',
    'bd_initiatives_phase_idx'
  ] LOOP
    SELECT EXISTS (
      SELECT 1 FROM pg_indexes WHERE indexname = _idx
    ) INTO _exists;
    IF _exists THEN
      _pass := _pass + 1;
      _results := array_append(_results, 'PASS | index_exists | ' || _idx);
    ELSE
      _fail := _fail + 1;
      _results := array_append(_results, 'FAIL | index_exists | ' || _idx);
    END IF;
  END LOOP;

  -- ═══════════════════════════════════════════════════════════════
  -- 4. Cron jobs registered
  -- ═══════════════════════════════════════════════════════════════
  FOREACH _job IN ARRAY ARRAY[
    'daily-generate-trends',
    'nightly-archive-mayday-videos',
    'nightly-clear-completed-projects',
    'fl-emit-due-notifications'
  ] LOOP
    SELECT EXISTS (
      SELECT 1 FROM cron.job WHERE jobname = _job
    ) INTO _exists;
    IF _exists THEN
      _pass := _pass + 1;
      _results := array_append(_results, 'PASS | cron_job | ' || _job);
    ELSE
      _fail := _fail + 1;
      _results := array_append(_results, 'FAIL | cron_job | ' || _job);
    END IF;
  END LOOP;

  -- ═══════════════════════════════════════════════════════════════
  -- 5. Helper functions exist
  -- ═══════════════════════════════════════════════════════════════
  FOREACH _fn IN ARRAY ARRAY[
    'is_admin',
    'is_freelancer',
    'bd_touch_updated_at',
    'bd_spawn_recurring_task'
  ] LOOP
    SELECT EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = _fn
    ) INTO _exists;
    IF _exists THEN
      _pass := _pass + 1;
      _results := array_append(_results, 'PASS | function_exists | ' || _fn);
    ELSE
      _fail := _fail + 1;
      _results := array_append(_results, 'FAIL | function_exists | ' || _fn);
    END IF;
  END LOOP;

  -- ═══════════════════════════════════════════════════════════════
  -- 6. Triggers attached
  -- ═══════════════════════════════════════════════════════════════
  FOREACH _trg IN ARRAY ARRAY[
    'bd_initiatives_touch',
    'bd_tasks_touch',
    'bd_tasks_recur'
  ] LOOP
    SELECT EXISTS (
      SELECT 1 FROM information_schema.triggers
      WHERE trigger_schema = 'public' AND trigger_name = _trg
    ) INTO _exists;
    IF _exists THEN
      _pass := _pass + 1;
      _results := array_append(_results, 'PASS | trigger_exists | ' || _trg);
    ELSE
      _fail := _fail + 1;
      _results := array_append(_results, 'FAIL | trigger_exists | ' || _trg);
    END IF;
  END LOOP;

  -- ═══════════════════════════════════════════════════════════════
  -- 7. CHECK constraints intact
  -- ═══════════════════════════════════════════════════════════════
  -- bd_initiatives status enum
  SELECT EXISTS (
    SELECT 1 FROM information_schema.check_constraints cc
    JOIN information_schema.constraint_column_usage ccu
      ON cc.constraint_name = ccu.constraint_name
    WHERE ccu.table_name = 'bd_initiatives' AND ccu.column_name = 'status'
  ) INTO _exists;
  IF _exists THEN
    _pass := _pass + 1;
    _results := array_append(_results, 'PASS | check_constraint | bd_initiatives.status');
  ELSE
    _fail := _fail + 1;
    _results := array_append(_results, 'FAIL | check_constraint | bd_initiatives.status');
  END IF;

  -- bd_tasks tag values
  SELECT EXISTS (
    SELECT 1 FROM information_schema.check_constraints cc
    JOIN information_schema.constraint_column_usage ccu
      ON cc.constraint_name = ccu.constraint_name
    WHERE ccu.table_name = 'bd_tasks' AND ccu.column_name = 'tag'
  ) INTO _exists;
  IF _exists THEN
    _pass := _pass + 1;
    _results := array_append(_results, 'PASS | check_constraint | bd_tasks.tag');
  ELSE
    _fail := _fail + 1;
    _results := array_append(_results, 'FAIL | check_constraint | bd_tasks.tag');
  END IF;

  -- ═══════════════════════════════════════════════════════════════
  -- Summary
  -- ═══════════════════════════════════════════════════════════════
  RAISE NOTICE '';
  RAISE NOTICE '══════════════════════════════════════════════════';
  RAISE NOTICE ' DATABASE HEALTH CHECK RESULTS';
  RAISE NOTICE '══════════════════════════════════════════════════';
  FOR i IN 1..array_length(_results, 1) LOOP
    RAISE NOTICE '%', _results[i];
  END LOOP;
  RAISE NOTICE '──────────────────────────────────────────────────';
  RAISE NOTICE 'PASSED: %  |  FAILED: %  |  TOTAL: %', _pass, _fail, _pass + _fail;
  RAISE NOTICE '══════════════════════════════════════════════════';

  IF _fail > 0 THEN
    RAISE EXCEPTION '% check(s) failed', _fail;
  END IF;

END $$;
