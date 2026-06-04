-- Add drive_uploaded_at to track when the file was originally uploaded to Drive.
-- created_at already tracks when the card was first synced.
alter table public.progress_cards
  add column drive_uploaded_at timestamptz;
