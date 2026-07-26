-- Optional time-of-day on contractor assignment due dates.
-- Pairs with due_date (both nullable); stored as a bare time so it reads
-- as "due at 3:00 PM" in whatever timezone the viewer is in.
alter table public.freelancer_assignments
  add column if not exists due_time time;
