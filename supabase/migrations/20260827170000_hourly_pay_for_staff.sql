-- Make the retainer + overtime pay system work for hourly STAFF, not just
-- contractors, tracking hours from the same place Payroll.js does.
--
-- The problem: overtime/retainer settings live on contractor_profiles and the
-- whole engine (fl_overtime_check_on_start, compute_freelancer_pay) reads
-- contractor_assignments. An hourly member logs hours on `tasks` flagged
-- requires_hours instead, so their settings were inert — configured in the UI,
-- read by nothing. Jacob Pereira had overtime + retainer enabled and was being
-- paid flat hours × rate.
--
-- Two things vary by role, so they're isolated in helpers rather than smeared
-- through the pay function:
--
--   hours   contractors -> contractor_assignments.hours_spent (completed)
--           staff       -> tasks.hours_spent (requires_hours + complete)
--   rate    contractors -> contractor_profiles.rate
--           staff       -> payroll_salaries.amount_cents where salary_type
--                          = 'hourly' and ended_at is null
--
-- Selection is by role, NOT a sum of both: summing would silently change
-- existing contractor pay if a contractor ever picked up a requires_hours task.
--
-- Retainer floor and overtime multiplier now apply identically to both
-- (Trevor's call, 2026-08-27) — a light window still pays the minimum.

-- ── Hours in a retainer window, from whichever source fits the role ─────────
CREATE OR REPLACE FUNCTION public.hourly_hours_in_window(p_user uuid, p_start date, p_end date)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_role text;
  v_hours numeric;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = p_user;

  IF v_role IN ('contractor', 'freelancer') THEN
    SELECT COALESCE(sum(ca.hours_spent), 0) INTO v_hours
    FROM public.contractor_assignments ca
    WHERE ca.contractor_id = p_user
      AND ca.hours_spent IS NOT NULL
      AND ca.completed_at IS NOT NULL
      AND (ca.completed_at AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN p_start AND p_end;
  ELSE
    -- Mirrors Payroll.js's member path exactly.
    SELECT COALESCE(sum(t.hours_spent), 0) INTO v_hours
    FROM public.tasks t
    WHERE t.assignee_id = p_user
      AND t.requires_hours = true
      AND t.status = 'complete'
      AND t.hours_spent IS NOT NULL
      AND t.completed_at IS NOT NULL
      AND (t.completed_at AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN p_start AND p_end;
  END IF;

  RETURN COALESCE(v_hours, 0);
END;
$$;

-- ── Hourly pay config: settings from contractor_profiles, rate by role ──────
CREATE OR REPLACE FUNCTION public.hourly_pay_config(p_user uuid)
RETURNS TABLE (
  is_hourly boolean,
  rate numeric,
  retainer_enabled boolean,
  retainer_min_hours numeric,
  overtime_enabled boolean,
  overtime_max_hours numeric,
  overtime_multiplier numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_role text;
  cp record;
  v_rate numeric;
  v_is_hourly boolean;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = p_user;

  SELECT payment_type, COALESCE(cpr.rate, 0) AS rate,
         COALESCE(cpr.retainer_enabled, false) AS retainer_enabled,
         cpr.retainer_min_hours,
         COALESCE(cpr.overtime_enabled, false) AS overtime_enabled,
         cpr.overtime_max_hours,
         COALESCE(cpr.overtime_multiplier, 1.5) AS overtime_multiplier
    INTO cp
    FROM public.contractor_profiles cpr WHERE cpr.id = p_user;

  IF v_role IN ('contractor', 'freelancer') THEN
    v_is_hourly := cp.payment_type IS NOT DISTINCT FROM 'hourly';
    v_rate := COALESCE(cp.rate, 0);
  ELSE
    -- Staff: payroll_salaries is the rate of record, not contractor_profiles.
    SELECT ps.amount_cents / 100.0 INTO v_rate
    FROM public.payroll_salaries ps
    WHERE ps.profile_id = p_user
      AND ps.salary_type = 'hourly'
      AND ps.ended_at IS NULL
    ORDER BY ps.effective_date DESC
    LIMIT 1;
    v_is_hourly := v_rate IS NOT NULL;
    v_rate := COALESCE(v_rate, 0);
  END IF;

  RETURN QUERY SELECT
    COALESCE(v_is_hourly, false),
    v_rate,
    COALESCE(cp.retainer_enabled, false),
    cp.retainer_min_hours,
    COALESCE(cp.overtime_enabled, false),
    cp.overtime_max_hours,
    COALESCE(cp.overtime_multiplier, 1.5);
END;
$$;

-- ── Pay computation, now role-aware ────────────────────────────────────────
-- Same shape and semantics as before; only the hours and rate lookups moved
-- behind the helpers, so contractor results are unchanged.
CREATE OR REPLACE FUNCTION public.compute_freelancer_pay(p_freelancer uuid, p_start date, p_end date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  fp record;
  w1s date; w1e date; w2s date; w2e date;
  windows jsonb := '[]'::jsonb;
  wstart date; wend date;
  a numeric; r numeric; m numeric; x numeric; rate numeric;
  base_hours numeric; ot_hours numeric; pay numeric;
  floor_applied boolean; approved boolean;
  total_hours numeric := 0; total_pay numeric := 0;
  i int;
BEGIN
  IF NOT (public.is_admin(auth.uid()) OR auth.uid() = p_freelancer) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT * INTO fp FROM public.hourly_pay_config(p_freelancer);
  rate := COALESCE(fp.rate, 0);
  x    := COALESCE(fp.overtime_multiplier, 1.5);

  SELECT ws, we INTO w1s, w1e FROM public.fl_retainer_window(p_start);
  SELECT ws, we INTO w2s, w2e FROM public.fl_retainer_window(w1e + 1);

  FOR i IN 1..2 LOOP
    IF i = 1 THEN wstart := w1s; wend := w1e; ELSE wstart := w2s; wend := w2e; END IF;

    a := public.hourly_hours_in_window(p_freelancer, wstart, wend);
    r := CASE WHEN fp.retainer_enabled THEN COALESCE(fp.retainer_min_hours, 0) ELSE 0 END;
    m := fp.overtime_max_hours;

    SELECT EXISTS (
      SELECT 1 FROM public.contractor_overtime_approvals
       WHERE contractor_id = p_freelancer
         AND retainer_start = wstart AND retainer_end = wend
         AND status = 'approved'
    ) INTO approved;

    IF fp.overtime_enabled AND approved AND m IS NOT NULL AND a > m THEN
      base_hours := greatest(m, r); ot_hours := a - m;
      pay := base_hours * rate + ot_hours * rate * x;
    ELSE
      base_hours := greatest(a, r); ot_hours := 0;
      pay := base_hours * rate;
    END IF;

    floor_applied := (r > a);
    windows := windows || jsonb_build_object(
      'window_start', wstart, 'window_end', wend, 'hours', a,
      'retainer_min', r, 'overtime_max', m, 'overtime_multiplier', x,
      'approved', approved, 'base_hours', base_hours, 'overtime_hours', ot_hours,
      'floor_applied', floor_applied, 'pay', round(pay, 2));
    total_hours := total_hours + a;
    total_pay := total_pay + pay;
  END LOOP;

  RETURN jsonb_build_object(
    'freelancer_id', p_freelancer, 'period_start', p_start, 'period_end', p_end,
    'payment_type', CASE WHEN fp.is_hourly THEN 'hourly' ELSE 'other' END,
    'rate', rate, 'retainer_enabled', fp.retainer_enabled,
    'overtime_enabled', fp.overtime_enabled, 'overtime_multiplier', x,
    'windows', windows, 'total_hours', total_hours, 'total_pay', round(total_pay, 2));
END;
$$;

-- ── Overtime approval for staff, raised when a task is completed ───────────
-- A contractor's hours are known when an assignment STARTS, so their check
-- runs on status -> in_progress. A member's hours only exist once the task is
-- finished, so this fires on completion: crossing within 5h of the cap warns
-- admins before the next task pushes them over.
CREATE OR REPLACE FUNCTION public.overtime_check_on_task_complete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  cfg record; v_role text; pt_today date; r_start date; r_end date;
  a numeric; appr_id uuid; who text; rec record; desc_text text;
BEGIN
  -- Only a freshly completed, hours-bearing task. The approval tasks this
  -- inserts have requires_hours unset, so they can't re-enter here.
  IF NEW.status <> 'complete' OR OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;
  IF NEW.requires_hours IS NOT TRUE OR NEW.hours_spent IS NULL OR NEW.assignee_id IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT role INTO v_role FROM public.profiles WHERE id = NEW.assignee_id;
    -- Contractors are covered by fl_overtime_check_on_start.
    IF v_role IN ('contractor', 'freelancer') THEN RETURN NEW; END IF;

    SELECT * INTO cfg FROM public.hourly_pay_config(NEW.assignee_id);
    IF NOT cfg.is_hourly OR NOT cfg.overtime_enabled OR cfg.overtime_max_hours IS NULL THEN
      RETURN NEW;
    END IF;

    pt_today := (now() AT TIME ZONE 'America/Los_Angeles')::date;
    SELECT ws, we INTO r_start, r_end FROM public.fl_retainer_window(pt_today);
    a := public.hourly_hours_in_window(NEW.assignee_id, r_start, r_end);

    IF a < cfg.overtime_max_hours - 5 THEN RETURN NEW; END IF;
    IF EXISTS (SELECT 1 FROM public.contractor_overtime_approvals
                WHERE contractor_id = NEW.assignee_id
                  AND retainer_start = r_start AND retainer_end = r_end) THEN
      RETURN NEW;
    END IF;

    INSERT INTO public.contractor_overtime_approvals
      (contractor_id, retainer_start, retainer_end, status)
      VALUES (NEW.assignee_id, r_start, r_end, 'pending')
      RETURNING id INTO appr_id;

    SELECT full_name INTO who FROM public.profiles WHERE id = NEW.assignee_id;
    who := COALESCE(who, 'A team member');
    desc_text := who || ' has ' || round(a, 2) || 'h logged this retainer period ('
      || to_char(r_start, 'Mon DD') || '-' || to_char(r_end, 'Mon DD')
      || '), within 5h of their ' || cfg.overtime_max_hours || 'h overtime cap. '
      || 'Completing this task APPROVES overtime pay (' || cfg.overtime_multiplier
      || 'x rate) for hours above the cap in this window. '
      || 'If no one approves, all hours are paid at the normal rate.';

    FOR rec IN SELECT id FROM public.profiles
                WHERE role IN ('admin', 'director')
                  AND COALESCE(status, 'active') <> 'archived'
    LOOP
      INSERT INTO public.tasks (step_key, title, description, assignee_id, status, position,
         related_entity_type, related_entity_id, nav_target, dedup_key)
      VALUES ('confirm_overtime', 'Approve overtime: ' || who, desc_text, rec.id, 'active', 0,
         'overtime_approval', appr_id, 'payroll', 'ot_' || appr_id::text || '_' || rec.id::text);
      INSERT INTO public.notifications (user_id, type, title, body, link_tab)
      VALUES (rec.id, 'fl_overtime_approval', 'Overtime approval needed',
         who || ' is nearing their overtime cap - review in My Tasks.', 'payroll');
    END LOOP;
  EXCEPTION WHEN others THEN
    -- Never block a task completion over a pay warning.
    RAISE WARNING 'overtime_check_on_task_complete failed for task %: %', NEW.id, sqlerrm;
    RETURN NEW;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS overtime_check_on_task_complete_trg ON public.tasks;
CREATE TRIGGER overtime_check_on_task_complete_trg
  AFTER UPDATE OF status ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.overtime_check_on_task_complete();

REVOKE ALL ON FUNCTION public.hourly_hours_in_window(uuid, date, date) FROM public;
REVOKE ALL ON FUNCTION public.hourly_pay_config(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.hourly_hours_in_window(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hourly_pay_config(uuid) TO authenticated;
