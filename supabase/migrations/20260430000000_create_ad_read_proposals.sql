-- Ad Read Proposals table
CREATE TABLE IF NOT EXISTS ad_read_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor_name TEXT NOT NULL,
  timeframe TEXT,
  num_videos INT,
  pay NUMERIC,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE ad_read_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view proposals"
  ON ad_read_proposals FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can create proposals"
  ON ad_read_proposals FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update proposals"
  ON ad_read_proposals FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE ad_read_proposals;
