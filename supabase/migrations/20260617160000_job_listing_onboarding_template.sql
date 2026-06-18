-- Per-role onboarding checklist template. When an application is accepted,
-- jobs-review uses this template (if non-empty) to seed job_onboarding.checklist;
-- otherwise it falls back to the DEFAULT_CHECKLIST baked into the edge function.
ALTER TABLE public.job_listings
  ADD COLUMN IF NOT EXISTS onboarding_checklist jsonb NOT NULL DEFAULT '[]'::jsonb;
