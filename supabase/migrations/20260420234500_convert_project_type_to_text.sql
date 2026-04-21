-- Convert projects.type from the project_type enum to plain text so that
-- business-board types (sponsorship, collaboration, documentation, administration)
-- are accepted alongside the existing creative types.
--
-- Same approach as 20260420232018_convert_project_status_to_text.sql.
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction, so converting the
-- column to text is the safest approach.

-- Drop the enum-typed default before altering the column type.
ALTER TABLE public.projects
  ALTER COLUMN type DROP DEFAULT;

ALTER TABLE public.projects
  ALTER COLUMN type TYPE text USING type::text;

ALTER TABLE public.projects
  ALTER COLUMN type SET DEFAULT 'youtube_video';

-- Drop the now-unused enum (no other columns should reference it).
-- If other tables do reference it, this will error and can be removed.
DROP TYPE IF EXISTS project_type;

-- Enforce all valid values via a check constraint.
ALTER TABLE public.projects
  ADD CONSTRAINT projects_type_check CHECK (
    type IN (
      'youtube_video', 'short_form', 'social_post', 'podcast', 'substack_article',
      'sponsorship', 'collaboration', 'documentation', 'administration',
      'other'
    )
  );
