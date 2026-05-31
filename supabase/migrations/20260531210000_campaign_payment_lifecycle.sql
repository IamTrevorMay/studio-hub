-- Sponsor campaign payment lifecycle for the Deliverables "Money" section.
--   fully_delivered_at: when the campaign's last deliverable was marked
--     delivered. Drives the Outstanding -> Late 45-day clock. Maintained by the
--     trigger below (stamped on full delivery, cleared if it regresses).
--   apply_agency_fee: whether the standard 20% agency cut reduces this
--     campaign's payout figures (Expected / Outstanding / Late / Paid).

ALTER TABLE sponsor_campaigns ADD COLUMN IF NOT EXISTS fully_delivered_at timestamptz;
ALTER TABLE sponsor_campaigns ADD COLUMN IF NOT EXISTS apply_agency_fee boolean NOT NULL DEFAULT true;

-- These two were handled outside the standard agency arrangement.
UPDATE sponsor_campaigns SET apply_agency_fee = false
WHERE name IN ('2025 MLB Postseason', 'Card Auctions');

-- Backfill: campaigns already fully delivered get stamped with their latest
-- deliverable date (best estimate of when they wrapped).
UPDATE sponsor_campaigns c
SET fully_delivered_at = sub.last_date::timestamptz
FROM (
  SELECT campaign_id,
         MAX(COALESCE(due_date, slot_date)) AS last_date,
         bool_and(delivered) AS all_delivered,
         count(*) AS n
  FROM sponsor_deliverables
  GROUP BY campaign_id
) sub
WHERE c.id = sub.campaign_id
  AND sub.n > 0
  AND sub.all_delivered
  AND sub.last_date IS NOT NULL
  AND c.fully_delivered_at IS NULL;

-- Keep fully_delivered_at in sync as deliverables are toggled / added / removed.
CREATE OR REPLACE FUNCTION sync_campaign_fully_delivered()
RETURNS trigger AS $$
DECLARE
  cid uuid;
  total int;
  delivered_count int;
BEGIN
  cid := COALESCE(NEW.campaign_id, OLD.campaign_id);
  IF cid IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  SELECT count(*), count(*) FILTER (WHERE delivered)
    INTO total, delivered_count
  FROM sponsor_deliverables WHERE campaign_id = cid;

  IF total > 0 AND total = delivered_count THEN
    -- Stamp the moment it becomes fully delivered; preserve an existing stamp.
    UPDATE sponsor_campaigns
      SET fully_delivered_at = COALESCE(fully_delivered_at, now())
      WHERE id = cid;
  ELSE
    UPDATE sponsor_campaigns
      SET fully_delivered_at = NULL
      WHERE id = cid AND fully_delivered_at IS NOT NULL;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_campaign_fully_delivered ON sponsor_deliverables;
CREATE TRIGGER trg_sync_campaign_fully_delivered
AFTER INSERT OR DELETE OR UPDATE OF delivered, campaign_id ON sponsor_deliverables
FOR EACH ROW EXECUTE FUNCTION sync_campaign_fully_delivered();
