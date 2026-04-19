-- Revenue transactions synced from Tiller Google Sheet
CREATE TABLE IF NOT EXISTS revenue_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id text UNIQUE NOT NULL,
  date date NOT NULL,
  description text,
  category text NOT NULL,
  amount_cents integer NOT NULL,
  account text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_revenue_transactions_date ON revenue_transactions(date);
CREATE INDEX idx_revenue_transactions_category ON revenue_transactions(category);

-- Allow authenticated users to read
ALTER TABLE revenue_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read revenue_transactions"
  ON revenue_transactions FOR SELECT
  TO authenticated
  USING (true);

-- Service role can insert/update
CREATE POLICY "Service role can manage revenue_transactions"
  ON revenue_transactions FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
