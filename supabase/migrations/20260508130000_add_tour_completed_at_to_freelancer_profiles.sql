alter table public.freelancer_profiles
  add column if not exists tour_completed_at timestamptz;
