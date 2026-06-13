-- Beat sheet templates are universal: any authenticated user can create, use,
-- rename, or delete any template. Loosen the creator-only DELETE policy and add
-- an UPDATE policy (rename) which previously did not exist.

DROP POLICY IF EXISTS "Users can delete own templates" ON beat_sheet_templates;

CREATE POLICY "Authenticated users can delete templates"
  ON beat_sheet_templates FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated users can update templates"
  ON beat_sheet_templates FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
