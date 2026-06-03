-- Add dedup_key column to automation_runs so dedup checks survive task
-- completion/deletion. The run log is permanent; tasks are not.
ALTER TABLE automation_runs ADD COLUMN IF NOT EXISTS dedup_key text;

-- Index for the dedup lookup: automation_id + dedup_key + status
CREATE INDEX IF NOT EXISTS idx_automation_runs_dedup
  ON automation_runs (automation_id, dedup_key, status)
  WHERE dedup_key IS NOT NULL;

-- Backfill existing successful runs that have a video_id in trigger_payload.
-- The Clip Video automation uses dedup template "clip_{{video_id}}".
UPDATE automation_runs
SET dedup_key = 'clip_' || (trigger_payload->>'video_id')
WHERE dedup_key IS NULL
  AND status = 'success'
  AND trigger_payload->>'video_id' IS NOT NULL;
