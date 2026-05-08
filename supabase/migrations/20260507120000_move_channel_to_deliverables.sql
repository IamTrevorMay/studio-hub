-- Move channel from sponsor_campaigns to sponsor_deliverables.
-- Campaigns are channel-agnostic; deliverables are channel-specific.

ALTER TABLE public.sponsor_deliverables
  ADD COLUMN IF NOT EXISTS channel text;

UPDATE public.sponsor_deliverables d
SET channel = c.channel
FROM public.sponsor_campaigns c
WHERE d.campaign_id = c.id
  AND d.channel IS NULL
  AND c.channel IS NOT NULL;

ALTER TABLE public.sponsor_campaigns
  DROP COLUMN IF EXISTS channel;
