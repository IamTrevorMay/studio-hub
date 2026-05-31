-- Payroll one-off line items + a recurring "Run payroll" task.

-- One-off payroll items, each scoped to a single pay period (period_start).
-- Added from the Payroll page for the current period only; included in that
-- period's totals.
CREATE TABLE IF NOT EXISTS public.payroll_one_offs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start date NOT NULL,
  label        text NOT NULL,
  payee        text,
  amount_cents integer NOT NULL DEFAULT 0,
  created_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   timestamptz DEFAULT now()
);

ALTER TABLE public.payroll_one_offs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payroll_one_offs admin all" ON public.payroll_one_offs
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_payroll_one_offs_period ON public.payroll_one_offs(period_start);

-- Recurring payroll reminder: a direct task assigned to Trevor May (admin) on
-- the 1st and 15th of each month, completed manually once payroll is run.
CREATE OR REPLACE FUNCTION public.create_payroll_run_task()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  trevor uuid;
BEGIN
  SELECT p.id INTO trevor
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE lower(u.email) = 'trevormayofficial@gmail.com'
  LIMIT 1;

  IF trevor IS NULL THEN
    RAISE NOTICE 'create_payroll_run_task: Trevor May profile not found';
    RETURN;
  END IF;

  -- Don't double-create if today's task already exists.
  IF EXISTS (
    SELECT 1 FROM public.tasks
    WHERE assignee_id = trevor
      AND step_key = 'direct_task'
      AND title = 'Run payroll'
      AND due_date::date = current_date
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.tasks
    (step_key, title, description, assignee_id, status, due_date, nav_target, created_by, position)
  VALUES
    ('direct_task', 'Run payroll',
     'Semi-monthly payroll run. Mark complete once payroll is submitted.',
     trevor, 'active', (current_date)::timestamptz, 'payroll', trevor, 0);
END;
$$;

-- Schedule for the 1st and 15th at 15:00 UTC (8am PT), matching the trends cron.
DO $$
BEGIN
  PERFORM cron.unschedule('payroll-run-task');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'payroll-run-task',
  '0 15 1,15 * *',
  $$SELECT public.create_payroll_run_task()$$
);
