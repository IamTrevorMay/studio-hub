-- Add 'archived' to personal_tasks status constraint
ALTER TABLE personal_tasks DROP CONSTRAINT IF EXISTS personal_tasks_status_check;
ALTER TABLE personal_tasks ADD CONSTRAINT personal_tasks_status_check
  CHECK (status IN ('inbox', 'backlog', 'ready', 'in_progress', 'holding', 'done', 'archived'));

-- Create daily_work_logs table
CREATE TABLE daily_work_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL,
  check_in_score smallint,
  check_in_note text,
  task_id uuid REFERENCES personal_tasks(id) ON DELETE SET NULL,
  task_content text NOT NULL,
  task_points integer NOT NULL DEFAULT 0,
  daily_total_points integer NOT NULL DEFAULT 0,
  sprint_id uuid REFERENCES sprints(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Unique index for idempotent upserts
CREATE UNIQUE INDEX daily_work_logs_user_date_task_idx ON daily_work_logs (user_id, date, task_id);

-- Query index
CREATE INDEX daily_work_logs_user_date_idx ON daily_work_logs (user_id, date DESC);

-- RLS: authenticated users can read own rows only; writes via service role
ALTER TABLE daily_work_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own work logs"
  ON daily_work_logs FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
