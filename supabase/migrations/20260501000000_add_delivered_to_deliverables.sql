-- Add delivered boolean to sponsor_deliverables for simple Open/Delivered toggle
ALTER TABLE sponsor_deliverables ADD COLUMN IF NOT EXISTS delivered BOOLEAN DEFAULT false;

-- Backfill: mark existing 'posted' deliverables as delivered
UPDATE sponsor_deliverables SET delivered = true WHERE status = 'posted';
