CREATE TABLE IF NOT EXISTS ooo_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID REFERENCES profiles(id),
  reviewed_at TIMESTAMPTZ,
  calendar_event_id UUID REFERENCES calendar_events(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE ooo_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view all OOO requests"
  ON ooo_requests FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can create their own OOO requests"
  ON ooo_requests FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can update any OOO request"
  ON ooo_requests FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
