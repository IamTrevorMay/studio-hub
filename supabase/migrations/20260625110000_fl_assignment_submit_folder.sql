-- Per-assignment override for the contractor "Submit" upload destination.
-- When set, the freelancer's submit step uploads here instead of the
-- hard-coded shared SUBMISSIONS_FOLDER_ID. Stores a bare Drive folder id
-- (the assignment form parses a pasted URL down to the id before saving).
-- Null = use the default shared submissions folder.
alter table public.freelancer_assignments
  add column if not exists submit_folder_id text;
