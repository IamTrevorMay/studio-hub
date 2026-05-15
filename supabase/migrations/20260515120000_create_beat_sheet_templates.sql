CREATE TABLE beat_sheet_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  beats JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE beat_sheet_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view templates" ON beat_sheet_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert templates" ON beat_sheet_templates FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Users can delete own templates" ON beat_sheet_templates FOR DELETE TO authenticated USING (auth.uid() = created_by);
