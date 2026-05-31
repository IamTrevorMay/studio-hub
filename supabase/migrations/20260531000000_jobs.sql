-- Jobs feature: public careers board + internal hiring/onboarding.
--   job_listings   — postings (public-readable when open)
--   job_applications — submissions (insert via edge fn only, admin reviews)
--   job_onboarding — per-hire checklist + link to the contractor invite

-- ─── Tables ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.job_listings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title           text NOT NULL,
  description     text,
  employment_type text CHECK (employment_type IN ('full_time','part_time','contract','freelance')),
  work_mode       text CHECK (work_mode IN ('remote','hybrid','onsite')),
  location        text,
  comp_range      text,
  department      text,
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed')),
  slug            text UNIQUE,
  position        integer NOT NULL DEFAULT 0,
  created_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  published_at    timestamptz
);

CREATE TABLE IF NOT EXISTS public.job_applications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id      uuid REFERENCES public.job_listings(id) ON DELETE SET NULL,
  applicant_name  text NOT NULL,
  applicant_email text NOT NULL,
  phone           text,
  resume_path     text,
  portfolio_links jsonb NOT NULL DEFAULT '[]',
  cover_note      text,
  status          text NOT NULL DEFAULT 'new' CHECK (status IN ('new','reviewing','interview','accepted','declined')),
  reviewer_id     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewer_notes  text,
  decided_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_job_applications_listing ON public.job_applications (listing_id);
CREATE INDEX IF NOT EXISTS idx_job_applications_status ON public.job_applications (status);

CREATE TABLE IF NOT EXISTS public.job_onboarding (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.job_applications(id) ON DELETE CASCADE,
  invitation_id  uuid,
  checklist      jsonb NOT NULL DEFAULT '[]',
  status         text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','complete')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_job_onboarding_application ON public.job_onboarding (application_id);

-- ─── RLS ─────────────────────────────────────────────────────
ALTER TABLE public.job_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_onboarding ENABLE ROW LEVEL SECURITY;

-- Anyone (including anonymous careers-page visitors) can read OPEN listings.
CREATE POLICY job_listings_public_read ON public.job_listings
  FOR SELECT TO anon, authenticated
  USING (status = 'open');

-- Admins manage everything on all three tables.
CREATE POLICY job_listings_admin_all ON public.job_listings
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY job_applications_admin_all ON public.job_applications
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY job_onboarding_admin_all ON public.job_onboarding
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));
-- Application inserts come through the jobs-apply edge function (service role),
-- so no public INSERT policy is needed.

-- ─── Résumé storage (private bucket; admins read via signed URLs) ──
INSERT INTO storage.buckets (id, name, public)
VALUES ('job-resumes', 'job-resumes', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY job_resumes_admin_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'job-resumes'
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );
