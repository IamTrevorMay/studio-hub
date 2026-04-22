-- All authenticated users can read all beat sheets.
-- Only the owner can insert/update/delete their own sheets.

DROP POLICY IF EXISTS "Users can manage own beat sheets" ON beat_sheets;

CREATE POLICY "All users can read beat sheets"
  ON beat_sheets FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can manage own beat sheets"
  ON beat_sheets FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
