-- Applied during initial trigger debugging: the trigger's ON CONFLICT clause
-- needs a true unique constraint, not a partial unique index. This swaps the
-- partial index for a full UNIQUE constraint.
--
-- 20260531155707_drive_event_to_assignment_trigger.sql now creates the
-- constraint directly, so this migration is effectively a no-op on a fresh
-- database. Kept for parity with the remote migration history.

DROP INDEX IF EXISTS public.uniq_fa_source_drive_event;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'freelancer_assignments_source_drive_event_id_key'
  ) THEN
    ALTER TABLE public.freelancer_assignments
      ADD CONSTRAINT freelancer_assignments_source_drive_event_id_key
      UNIQUE (source_drive_event_id);
  END IF;
END $$;
