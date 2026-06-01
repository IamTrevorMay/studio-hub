-- Add pay method columns to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pay_method text CHECK (pay_method IN ('auto','paypal','venmo')),
  ADD COLUMN IF NOT EXISTS pay_method_detail text;

-- Create payroll_paid table for per-period paid tracking
CREATE TABLE public.payroll_paid (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  paid_at      timestamptz DEFAULT now(),
  paid_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  UNIQUE (profile_id, period_start)
);

ALTER TABLE public.payroll_paid ENABLE ROW LEVEL SECURITY;

-- Admin-only read
CREATE POLICY "payroll_paid_select_admin"
  ON public.payroll_paid FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
    )
  );

-- Admin-only insert
CREATE POLICY "payroll_paid_insert_admin"
  ON public.payroll_paid FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
    )
  );

-- Admin-only delete
CREATE POLICY "payroll_paid_delete_admin"
  ON public.payroll_paid FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
    )
  );
