-- Add last_seen_at to support reconciling Tiller syncs. sync-tiller now stamps
-- every upserted row with the current run timestamp, then deletes any
-- Tiller-sourced row NOT seen in the latest pull. This prunes both transactions
-- removed from the sheet and legacy duplicates created by the old row-number
-- based transaction_id scheme (row numbers shift on reorder, so the same
-- transaction kept getting re-inserted under a new id).

ALTER TABLE public.revenue_transactions ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
ALTER TABLE public.expense_transactions ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
