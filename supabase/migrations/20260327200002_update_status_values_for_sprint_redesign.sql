-- 1. Drop old CHECK constraint on personal_tasks.status
ALTER TABLE personal_tasks DROP CONSTRAINT IF EXISTS personal_tasks_status_check;

-- 2. Migrate existing data: today → in_progress, this_week → ready
UPDATE personal_tasks SET status = 'in_progress' WHERE status = 'today';
UPDATE personal_tasks SET status = 'ready' WHERE status = 'this_week';

-- 3. Add new CHECK constraint with updated values
ALTER TABLE personal_tasks ADD CONSTRAINT personal_tasks_status_check
  CHECK (status IN ('inbox', 'backlog', 'ready', 'in_progress', 'holding', 'done'));

-- 4. Add archived_at column to sprints table
ALTER TABLE sprints ADD COLUMN IF NOT EXISTS archived_at timestamptz;
