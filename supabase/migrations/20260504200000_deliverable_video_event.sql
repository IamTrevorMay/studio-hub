-- Add video_event_id FK to sponsor_deliverables (many-to-one: multiple deliverables can attach to the same video_post event)
ALTER TABLE sponsor_deliverables
  ADD COLUMN video_event_id UUID REFERENCES calendar_events(id) ON DELETE SET NULL;
