-- Global recipients list for the Clipping Tool.
-- Shared across all users; only admins may edit.

CREATE TABLE IF NOT EXISTS public.clipping_tool_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT '',
  drive_folder_id TEXT NOT NULL DEFAULT '',
  drive_folder_name TEXT NOT NULL DEFAULT '',
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed with current defaults
INSERT INTO public.clipping_tool_recipients (name, drive_folder_id, drive_folder_name, position)
VALUES
  ('Aaron', '', '', 0),
  ('Alana', '', '', 1);

-- RLS: all authenticated can read, only admins can write
ALTER TABLE public.clipping_tool_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read recipients"
  ON public.clipping_tool_recipients FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Admins can insert recipients"
  ON public.clipping_tool_recipients FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admins can update recipients"
  ON public.clipping_tool_recipients FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admins can delete recipients"
  ON public.clipping_tool_recipients FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );
