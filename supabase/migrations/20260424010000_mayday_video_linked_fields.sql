-- Add linked document/asset fields and segment to mayday_videos.

ALTER TABLE mayday_videos
  ADD COLUMN IF NOT EXISTS write_doc_id TEXT,
  ADD COLUMN IF NOT EXISTS write_doc_name TEXT,
  ADD COLUMN IF NOT EXISTS beat_sheet_id UUID REFERENCES beat_sheets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ad_read_id UUID REFERENCES sponsor_deliverables(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS segment TEXT;
