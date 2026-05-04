-- Add pay and beat_sheet_id columns to sponsor_deliverables
ALTER TABLE sponsor_deliverables
  ADD COLUMN IF NOT EXISTS pay NUMERIC,
  ADD COLUMN IF NOT EXISTS beat_sheet_id UUID REFERENCES beat_sheets(id) ON DELETE SET NULL;
