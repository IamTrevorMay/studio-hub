-- Add linked document/asset fields to projects table.
-- write_doc: linked Google Drive doc from Write page
-- beat_sheet: linked beat sheet from Beat Sheets page
-- ad_read: linked sponsor deliverable for ad read tracking

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS write_doc_id TEXT,
  ADD COLUMN IF NOT EXISTS write_doc_name TEXT,
  ADD COLUMN IF NOT EXISTS beat_sheet_id UUID REFERENCES beat_sheets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ad_read_id UUID REFERENCES sponsor_deliverables(id) ON DELETE SET NULL;
