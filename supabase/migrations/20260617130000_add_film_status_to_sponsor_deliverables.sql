ALTER TABLE public.sponsor_deliverables
  ADD COLUMN IF NOT EXISTS film_status text NOT NULL DEFAULT 'not_ready';
