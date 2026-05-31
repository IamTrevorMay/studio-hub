-- Multi-business accounting. Each transaction now belongs to a business so the
-- Accounting page can split / combine Mayday Media and Neptune Performance.
-- Existing rows are all Mayday Media (the only Tiller source until now).
-- sync-tiller stamps each row with its source business.

ALTER TABLE public.revenue_transactions ADD COLUMN IF NOT EXISTS business text NOT NULL DEFAULT 'mayday_media';
ALTER TABLE public.expense_transactions ADD COLUMN IF NOT EXISTS business text NOT NULL DEFAULT 'mayday_media';

CREATE INDEX IF NOT EXISTS idx_revenue_transactions_business ON public.revenue_transactions(business);
CREATE INDEX IF NOT EXISTS idx_expense_transactions_business ON public.expense_transactions(business);
