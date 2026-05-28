-- Track when a contractor declines an assignment. The row stays in place so
-- the admin can see who declined what and reassign; the contractor's view
-- filters out anything with declined_at set.

alter table public.freelancer_assignments
  add column if not exists declined_at timestamptz;
