-- Add finished-video link to sponsor deliverables (Deliverables page "Video" flow)
alter table public.sponsor_deliverables
  add column if not exists video_url text;
