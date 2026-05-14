-- Add priority column (1-10, no 7) to dashboard_todos, daily_itinerary, bd_user_notes
ALTER TABLE public.dashboard_todos
  ADD COLUMN IF NOT EXISTS priority smallint
  CONSTRAINT dashboard_todos_priority_check CHECK (priority IN (1,2,3,4,5,6,8,9,10));

ALTER TABLE public.daily_itinerary
  ADD COLUMN IF NOT EXISTS priority smallint
  CONSTRAINT daily_itinerary_priority_check CHECK (priority IN (1,2,3,4,5,6,8,9,10));

ALTER TABLE public.bd_user_notes
  ADD COLUMN IF NOT EXISTS priority smallint
  CONSTRAINT bd_user_notes_priority_check CHECK (priority IN (1,2,3,4,5,6,8,9,10));
