-- Beat sheet version history: application-level snapshots for recovery
CREATE TABLE beat_sheet_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id UUID NOT NULL REFERENCES beat_sheets(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  beats JSONB NOT NULL,
  beat_count INT NOT NULL DEFAULT 0,
  saved_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_beat_sheet_versions_sheet
  ON beat_sheet_versions(sheet_id, created_at DESC);

-- RLS: all authenticated users can read and insert (matches beat_sheets team access)
ALTER TABLE beat_sheet_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view beat sheet versions"
  ON beat_sheet_versions FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert beat sheet versions"
  ON beat_sheet_versions FOR INSERT
  TO authenticated
  WITH CHECK (true);
