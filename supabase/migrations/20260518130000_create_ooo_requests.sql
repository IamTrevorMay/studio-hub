-- Out-of-office requests table.
-- Members submit requests; admins approve/reject.
CREATE TABLE IF NOT EXISTS public.ooo_requests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  start_date     date NOT NULL,
  end_date       date NOT NULL,
  status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at    timestamptz,
  calendar_event_id uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Index for the two dashboard queries (pending list + today's approved)
CREATE INDEX IF NOT EXISTS idx_ooo_requests_status ON public.ooo_requests(status);
CREATE INDEX IF NOT EXISTS idx_ooo_requests_approved_dates ON public.ooo_requests(status, start_date, end_date)
  WHERE status = 'approved';

-- RLS
ALTER TABLE public.ooo_requests ENABLE ROW LEVEL SECURITY;

-- Everyone can read (needed for presence dot coloring)
CREATE POLICY ooo_requests_select ON public.ooo_requests
  FOR SELECT USING (true);

-- Members can insert their own requests
CREATE POLICY ooo_requests_insert ON public.ooo_requests
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Admins can update any request (approve/reject)
CREATE POLICY ooo_requests_update ON public.ooo_requests
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.ooo_requests;
