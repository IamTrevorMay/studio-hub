-- All authenticated users can read, edit, and delete all beat sheets.

DROP POLICY IF EXISTS "All users can read beat sheets" ON beat_sheets;
DROP POLICY IF EXISTS "Users can manage own beat sheets" ON beat_sheets;

CREATE POLICY "All users can manage all beat sheets"
  ON beat_sheets FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
