-- Manual notes on business transactions, editable by admins from the
-- Accounting page ledger tables. Category edits were already allowed by the
-- *_admin_update policies (20260704180000_plaid_bank_feed.sql); this adds the
-- notes column those edits pair with. Neither sync writes notes — sync-tiller
-- upserts omit the column and plaid-sync only refreshes amount/date/description
-- — so manual notes survive re-syncs on both sources.

alter table public.revenue_transactions add column if not exists notes text;
alter table public.expense_transactions add column if not exists notes text;
