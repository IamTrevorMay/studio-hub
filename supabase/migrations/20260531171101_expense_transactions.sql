-- Expense side of the Tiller sync. Mirrors revenue_transactions:
-- sync-tiller reads one Sheet, splits rows into income (revenue_transactions)
-- and expenses (here) using two whitelists. The Expenses admin page queries
-- this table directly.
--
-- Admin-only read; service role writes (sync-tiller uses the service role).

CREATE TABLE IF NOT EXISTS public.expense_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id text UNIQUE NOT NULL,
  date date NOT NULL,
  description text,
  category text NOT NULL,
  amount_cents integer NOT NULL,
  account text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expense_transactions_date ON public.expense_transactions(date);
CREATE INDEX IF NOT EXISTS idx_expense_transactions_category ON public.expense_transactions(category);

ALTER TABLE public.expense_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read expense_transactions" ON public.expense_transactions
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Service role can manage expense_transactions" ON public.expense_transactions
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
