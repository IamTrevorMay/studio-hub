-- expense_transactions was the last accounting table still testing
-- `role = 'admin'` literally, while its siblings (revenue_transactions,
-- linked_accounts, account_balances, monthly_reports) all moved to the
-- admin-tier is_admin() helper. Nothing depended on the difference — the
-- Accounting page is held shut for directors by ROLE_RESTRICTED_NAV_KEYS, not
-- by this policy — but a director reaching the data any other way would have
-- gotten revenue and no expenses, which is worse than either answer.
--
-- Behaviour-neutral today. It just stops the DB from contradicting itself.

drop policy if exists "Admins can read expense_transactions" on public.expense_transactions;

create policy "Admins can read expense_transactions" on public.expense_transactions
  for select to authenticated
  using (public.is_admin());
