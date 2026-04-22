-- Add channel field to sponsor_campaigns
-- Options: 'mayday', 'tmb' (Trevor May Baseball), 'socials'

ALTER TABLE public.sponsor_campaigns
  ADD COLUMN IF NOT EXISTS channel text;
