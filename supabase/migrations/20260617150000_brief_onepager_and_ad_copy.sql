-- Brief one-pager support
ALTER TABLE campaign_briefs
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS source_text text,
  ADD COLUMN IF NOT EXISTS onepager_md text,
  ADD COLUMN IF NOT EXISTS generated_at timestamptz;

-- Existing 'type' column already distinguishes 'link' vs 'doc'.
-- source_type adds finer detail for new flow: 'link' | 'file' | 'text'.

-- Public read of generated one-pager (no auth) so "Brief" button can open in new tab.
-- Only onepager_md rows that have content; raw uploads still gated by storage auth.
DROP POLICY IF EXISTS "Public read onepager briefs" ON campaign_briefs;
CREATE POLICY "Public read onepager briefs"
  ON campaign_briefs FOR SELECT TO anon
  USING (onepager_md IS NOT NULL);

-- Ad copy field on deliverables (replaces use of notes for ad-read text)
ALTER TABLE sponsor_deliverables
  ADD COLUMN IF NOT EXISTS ad_copy text;

-- Backfill ad_copy from notes once, only when ad_copy is null.
UPDATE sponsor_deliverables
  SET ad_copy = notes
  WHERE ad_copy IS NULL AND notes IS NOT NULL;
