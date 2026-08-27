-- Fix the source my_pay_period_hours() reads from.
--
-- The first cut read the CONTRACTOR path (contractor_profiles.payment_type +
-- contractor_assignments.hours_spent). That is wrong for staff, and staff are
-- the only people who see the Dashboard this feeds. Payroll.js is the source of
-- truth, and its member path is:
--
--   hourly?  payroll_salaries.salary_type = 'hourly' AND ended_at IS NULL
--   hours?   tasks WHERE requires_hours AND status = 'complete'
--            AND hours_spent IS NOT NULL, by assignee_id, completed_at in period
--
-- contractor_profiles.payment_type still governs CONTRACTORS (whose pay is built
-- from contractor_assignments), so both paths are kept — a person is on exactly
-- one of them, so summing both is safe and stays correct if this widget is ever
-- added to the contractor portal.
--
-- Still returns only the caller's own aggregate: never a rate, never an amount.

DROP FUNCTION IF EXISTS public.my_pay_period_hours();

CREATE FUNCTION public.my_pay_period_hours()
RETURNS TABLE (
  is_hourly boolean,
  period_start date,
  period_end date,
  hours numeric,
  entry_count integer,
  submitted_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  uid uuid := auth.uid();
  today date := (now() AT TIME ZONE 'America/Los_Angeles')::date;
  p_start date;
  p_end date;
BEGIN
  IF uid IS NULL THEN
    RETURN;
  END IF;

  IF EXTRACT(day FROM today) <= 15 THEN
    p_start := date_trunc('month', today)::date;
    p_end := (date_trunc('month', today) + interval '14 days')::date;
  ELSE
    p_start := (date_trunc('month', today) + interval '15 days')::date;
    p_end := (date_trunc('month', today) + interval '1 month' - interval '1 day')::date;
  END IF;

  RETURN QUERY
  SELECT
    -- Staff: an active hourly salary row. Contractors: their payment type.
    (
      EXISTS (
        SELECT 1 FROM public.payroll_salaries ps
        WHERE ps.profile_id = uid
          AND ps.salary_type = 'hourly'
          AND ps.ended_at IS NULL
      )
      OR EXISTS (
        SELECT 1 FROM public.contractor_profiles cp
        JOIN public.profiles pr ON pr.id = cp.id
        WHERE cp.id = uid
          AND cp.payment_type = 'hourly'
          AND pr.role = 'contractor'
      )
    ),
    p_start,
    p_end,
    (COALESCE(t.sum_hours, 0) + COALESCE(a.sum_hours, 0))::numeric,
    (COALESCE(t.cnt, 0) + COALESCE(a.cnt, 0))::integer,
    h.submitted_at
  FROM (SELECT 1) AS _anchor
  LEFT JOIN LATERAL (
    -- Staff hours: "Report Hours to Complete" tasks closed in this period.
    SELECT sum(tk.hours_spent) AS sum_hours, count(*)::integer AS cnt
    FROM public.tasks tk
    WHERE tk.assignee_id = uid
      AND tk.requires_hours = true
      AND tk.status = 'complete'
      AND tk.hours_spent IS NOT NULL
      AND tk.completed_at IS NOT NULL
      AND (tk.completed_at AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN p_start AND p_end
  ) t ON true
  LEFT JOIN LATERAL (
    -- Contractor hours: completed assignments, same rule as ContractorHours.js.
    SELECT sum(ca.hours_spent) AS sum_hours, count(*)::integer AS cnt
    FROM public.contractor_assignments ca
    WHERE ca.contractor_id = uid
      AND ca.completed_at IS NOT NULL
      AND ca.hours_spent IS NOT NULL
      AND (ca.completed_at AT TIME ZONE 'America/Los_Angeles')::date
          BETWEEN p_start AND p_end
  ) a ON true
  -- Only contractors attest to a period; staff have no submit step, so this
  -- stays NULL for them and the UI shows no submission state.
  LEFT JOIN public.contractor_hours h
    ON h.contractor_id = uid
   AND h.period_start = p_start
   AND h.period_end = p_end;
END;
$$;

REVOKE ALL ON FUNCTION public.my_pay_period_hours() FROM public;
GRANT EXECUTE ON FUNCTION public.my_pay_period_hours() TO authenticated;
