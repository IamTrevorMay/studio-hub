-- Convert projects.status from the project_status enum to plain text so that
-- business-board statuses (backlog, in_progress, holding, completed) are accepted
-- alongside the existing creative statuses.
--
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction, so converting the
-- column to text is the safest approach.

ALTER TABLE public.projects
  ALTER COLUMN status TYPE text USING status::text;

-- Drop the now-unused enum (no other columns should reference it).
-- If other tables do reference it, this will error and can be removed.
DROP TYPE IF EXISTS project_status;

-- Enforce all valid values via a check constraint.
ALTER TABLE public.projects
  ADD CONSTRAINT projects_status_check CHECK (
    status IN (
      'concept', 'script', 'production', 'edit', 'review', 'published',
      'backlog', 'in_progress', 'holding', 'completed'
    )
  );
