-- Add category column to projects to split Creative vs Business boards.
-- Creative projects use the existing statuses/types; Business projects
-- use their own set (enforced in the UI).

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'creative';

-- Drop legacy check constraints (if any) so business statuses/types are allowed.
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_type_check;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_status_check;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $$;

-- Ensure category stays one of the two supported values.
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_category_check;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $$;

ALTER TABLE public.projects
  ADD CONSTRAINT projects_category_check
  CHECK (category IN ('creative', 'business'));

CREATE INDEX IF NOT EXISTS idx_projects_category ON public.projects(category);
