-- Video slot config: fixed upload schedule per channel
-- day_of_week matches JS Date.getDay(): 0=Sun, 6=Sat

CREATE TABLE IF NOT EXISTS public.video_slot_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel TEXT NOT NULL,
  day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (channel, day_of_week)
);

ALTER TABLE public.video_slot_config ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read
CREATE POLICY "Authenticated can read video_slot_config"
  ON public.video_slot_config FOR SELECT
  TO authenticated USING (true);

-- Admins can do everything
CREATE POLICY "Admins can manage video_slot_config"
  ON public.video_slot_config FOR ALL
  TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Seed: Mayday = Mon/Wed/Thu/Fri, TMB = Sun/Tue
INSERT INTO public.video_slot_config (channel, day_of_week) VALUES
  ('mayday', 1),
  ('mayday', 3),
  ('mayday', 4),
  ('mayday', 5),
  ('tmb', 0),
  ('tmb', 2);
