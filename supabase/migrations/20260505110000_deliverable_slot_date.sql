ALTER TABLE public.sponsor_deliverables
  ADD COLUMN IF NOT EXISTS slot_date DATE;
