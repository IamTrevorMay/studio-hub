-- Optional link to an asset (or any URL) that the contractor needs for the job.
-- Typically pasted from the Assets Library (assets.maydaystudio.net) or a
-- Drive share/download URL. Surfaced in the assignment detail and the
-- new-assignment email.

alter table public.freelancer_assignments
  add column if not exists asset_url text;
