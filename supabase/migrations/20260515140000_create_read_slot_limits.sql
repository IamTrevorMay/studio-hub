CREATE TABLE read_slot_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month TEXT NOT NULL,          -- e.g. '2026-05'
  channel TEXT NOT NULL,        -- 'mayday' or 'tmb'
  slot_limit INT NOT NULL DEFAULT 0,
  created_by UUID REFERENCES profiles(id),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(month, channel)
);

ALTER TABLE read_slot_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view slot limits"
  ON read_slot_limits FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert slot limits"
  ON read_slot_limits FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update slot limits"
  ON read_slot_limits FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
