-- Allow source='tiller_v1' on the transaction tables. These rows are the
-- historical Mayday import from the old (pre-break) Tiller doc, loaded once by
-- the import-tiller-v1 edge function. They carry the old doc's categories
-- verbatim and are deliberately outside sync-tiller's reconcile (which only
-- prunes source='tiller'), so the daily sync can never delete them.

alter table public.expense_transactions drop constraint expense_transactions_source_check;
alter table public.expense_transactions add constraint expense_transactions_source_check
  check (source = any (array['tiller'::text, 'tiller_v1'::text, 'plaid'::text, 'manual'::text]));

alter table public.revenue_transactions drop constraint revenue_transactions_source_check;
alter table public.revenue_transactions add constraint revenue_transactions_source_check
  check (source = any (array['tiller'::text, 'tiller_v1'::text, 'plaid'::text, 'manual'::text]));
