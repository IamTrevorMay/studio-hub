-- Add hours_spent column to freelancer_assignments
ALTER TABLE public.freelancer_assignments
  ADD COLUMN IF NOT EXISTS hours_spent numeric(6,2);

-- Create payroll_salaries table
CREATE TABLE public.payroll_salaries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  salary_type    text NOT NULL CHECK (salary_type IN ('per_period', 'yearly')),
  amount_cents   integer NOT NULL DEFAULT 0,
  effective_date date NOT NULL DEFAULT current_date,
  ended_at       date,
  created_by     uuid REFERENCES public.profiles(id),
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now(),
  CONSTRAINT unique_active_salary UNIQUE (profile_id, effective_date)
);

ALTER TABLE public.payroll_salaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payroll_salaries admin all" ON public.payroll_salaries
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));
