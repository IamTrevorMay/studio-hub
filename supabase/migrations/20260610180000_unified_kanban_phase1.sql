-- Unified Content Kanban — Phase 1 schema + backfill
-- See PLANNING.md "Unified Content Kanban (locked spec, 2026-06-10)"
--
-- Adds card-level fields (hold, archive, start_column) on projects.
-- Collapses 10 project types → 4 (mayday_video, tm_baseball_video, podcast, short_form).
-- Renames status enum values to canonical (idea/write/produce/edit/review/publish).
-- Creates project_card_notes (rolling per-stage notes thread) and
-- project_card_handoffs (outgoing-assignee handoff notes per column transition).

-- =============================================================================
-- 1. Add new columns on projects
-- =============================================================================
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS on_hold       boolean      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hold_reason   text,
  ADD COLUMN IF NOT EXISTS archived_at   timestamptz,
  ADD COLUMN IF NOT EXISTS start_column  text;

-- =============================================================================
-- 2. Drop existing constraints/defaults so we can backfill values
-- =============================================================================
ALTER TABLE public.projects ALTER COLUMN type   DROP DEFAULT;
ALTER TABLE public.projects ALTER COLUMN type   DROP NOT NULL;
ALTER TABLE public.projects ALTER COLUMN status DROP DEFAULT;

ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_type_check;
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_status_check;

-- =============================================================================
-- 3. Backfill — type collapse (10 → 4 + NULL re-tag tray)
-- =============================================================================
UPDATE public.projects SET type = 'mayday_video' WHERE type = 'youtube_video';

UPDATE public.projects SET type = NULL WHERE type IN (
  'social_post', 'substack_article', 'sponsorship',
  'collaboration', 'documentation', 'administration', 'other'
);
-- short_form, podcast unchanged

-- =============================================================================
-- 4. Backfill — status rename to canonical
-- =============================================================================
UPDATE public.projects SET status = 'idea'    WHERE status = 'concept';
UPDATE public.projects SET status = 'write'   WHERE status = 'script';
UPDATE public.projects SET status = 'produce' WHERE status = 'production';
UPDATE public.projects SET status = 'publish' WHERE status = 'published';
-- edit, review unchanged

-- Business-status cards (going to re-tag tray) park at 'idea' until tagged
UPDATE public.projects SET status = 'idea'
  WHERE status IN ('backlog', 'in_progress', 'holding', 'completed');

-- Legacy shorts stages — if any ever lived in projects.status, map them
UPDATE public.projects SET status = 'edit'    WHERE status = 'editing';
UPDATE public.projects SET status = 'review'  WHERE status = 'ready_to_post';
UPDATE public.projects SET status = 'publish' WHERE status = 'posted';

-- =============================================================================
-- 5. Re-add tightened constraints
-- =============================================================================
ALTER TABLE public.projects
  ADD CONSTRAINT projects_type_check CHECK (
    type IS NULL OR type IN (
      'mayday_video', 'tm_baseball_video', 'podcast', 'short_form'
    )
  );

ALTER TABLE public.projects
  ADD CONSTRAINT projects_status_check CHECK (
    status IN ('idea', 'write', 'produce', 'edit', 'review', 'publish')
  );

ALTER TABLE public.projects
  ADD CONSTRAINT projects_start_column_check CHECK (
    start_column IS NULL OR start_column IN (
      'idea', 'write', 'produce', 'edit', 'review', 'publish'
    )
  );

ALTER TABLE public.projects ALTER COLUMN status SET DEFAULT 'idea';
-- type has no default; admin chooses on create

-- =============================================================================
-- 6. New table — project_card_notes (rolling per-stage notes thread)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.project_card_notes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  stage      text NOT NULL,
  body       text NOT NULL,
  author_id  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_card_notes_stage_check CHECK (
    stage IN ('idea', 'write', 'produce', 'edit', 'review', 'publish')
  )
);

CREATE INDEX IF NOT EXISTS project_card_notes_project_id_idx
  ON public.project_card_notes (project_id);
CREATE INDEX IF NOT EXISTS project_card_notes_project_stage_idx
  ON public.project_card_notes (project_id, stage);

ALTER TABLE public.project_card_notes ENABLE ROW LEVEL SECURITY;

-- Visibility: admin + assistant + member only (no freelancers)
CREATE POLICY "Non-freelancer read notes"
  ON public.project_card_notes FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin', 'assistant', 'member')
    )
  );

CREATE POLICY "Non-freelancer write notes"
  ON public.project_card_notes FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin', 'assistant', 'member')
    )
  );

CREATE POLICY "Author or admin update notes"
  ON public.project_card_notes FOR UPDATE TO authenticated
  USING (
    author_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

CREATE POLICY "Author or admin delete notes"
  ON public.project_card_notes FOR DELETE TO authenticated
  USING (
    author_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

-- =============================================================================
-- 7. New table — project_card_handoffs (exit notes per column transition)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.project_card_handoffs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  from_stage text NOT NULL,
  to_stage   text NOT NULL,
  body       text NOT NULL,
  author_id  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_card_handoffs_from_stage_check CHECK (
    from_stage IN ('idea', 'write', 'produce', 'edit', 'review', 'publish')
  ),
  CONSTRAINT project_card_handoffs_to_stage_check CHECK (
    to_stage IN ('idea', 'write', 'produce', 'edit', 'review', 'publish')
  )
);

CREATE INDEX IF NOT EXISTS project_card_handoffs_project_id_idx
  ON public.project_card_handoffs (project_id);

ALTER TABLE public.project_card_handoffs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Non-freelancer read handoffs"
  ON public.project_card_handoffs FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin', 'assistant', 'member')
    )
  );

CREATE POLICY "Non-freelancer write handoffs"
  ON public.project_card_handoffs FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin', 'assistant', 'member')
    )
  );

CREATE POLICY "Author or admin update handoffs"
  ON public.project_card_handoffs FOR UPDATE TO authenticated
  USING (
    author_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

CREATE POLICY "Author or admin delete handoffs"
  ON public.project_card_handoffs FOR DELETE TO authenticated
  USING (
    author_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

-- =============================================================================
-- 8. Indexes on projects to support board queries
-- =============================================================================
CREATE INDEX IF NOT EXISTS projects_type_status_idx
  ON public.projects (type, status) WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS projects_on_hold_idx
  ON public.projects (on_hold) WHERE on_hold = true;

CREATE INDEX IF NOT EXISTS projects_archived_at_idx
  ON public.projects (archived_at) WHERE archived_at IS NOT NULL;
