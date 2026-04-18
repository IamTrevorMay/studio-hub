CREATE TABLE beat_sheets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Untitled Beat Sheet',
  beats JSONB NOT NULL DEFAULT '[]'::jsonb,
  drive_folder_id TEXT,
  drive_folder_name TEXT,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE beat_sheets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own beat sheets"
  ON beat_sheets FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
