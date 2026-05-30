-- Two-tier workflow versioning: manual Publish bumps the major version
-- (1 -> 2 -> 3), auto-save records micro-versions under the current major
-- (1.001, 1.002, ...). version_number becomes numeric to hold both.
-- Existing integer values (1, 2, ...) convert cleanly to 1.000, 2.000.

ALTER TABLE public.workflow_versions
  ALTER COLUMN version_number TYPE numeric USING version_number::numeric;
