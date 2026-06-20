-- Prevent duplicate version numbers per review. handleSendRevision computes the
-- next version_number with a read-max-then-insert, which races: two concurrent
-- revisions read the same max and insert duplicates. This unique constraint makes
-- the loser fail with 23505 so the client can recompute and retry.
alter table public.script_review_versions
  add constraint script_review_versions_review_version_uniq
  unique (review_id, version_number);
