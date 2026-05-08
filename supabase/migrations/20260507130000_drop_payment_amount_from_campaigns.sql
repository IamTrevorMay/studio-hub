-- Campaign total now comes from aggregating sponsor_deliverables.pay.

ALTER TABLE public.sponsor_campaigns
  DROP COLUMN IF EXISTS payment_amount;
