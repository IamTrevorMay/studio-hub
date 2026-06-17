-- New table for multiple briefs per campaign
CREATE TABLE campaign_briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES sponsor_campaigns(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'link',  -- 'link' or 'doc'
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: match sponsor_campaigns policies
ALTER TABLE campaign_briefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read campaign_briefs"
  ON campaign_briefs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert campaign_briefs"
  ON campaign_briefs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update campaign_briefs"
  ON campaign_briefs FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete campaign_briefs"
  ON campaign_briefs FOR DELETE TO authenticated USING (true);

-- Migrate existing single-brief data
INSERT INTO campaign_briefs (campaign_id, type, label, url, position)
SELECT id,
  CASE WHEN brief_url LIKE '%campaign-briefs%' THEN 'doc' ELSE 'link' END,
  COALESCE(brief_name, 'Brief'),
  brief_url,
  0
FROM sponsor_campaigns
WHERE brief_url IS NOT NULL;
