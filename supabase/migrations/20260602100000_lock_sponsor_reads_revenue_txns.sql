-- CRIT: sponsor_reads + revenue_transactions previously open to all authed.
-- sponsor_reads: full CRUD by any authed user (payout amounts, ad copy).
-- revenue_transactions: SELECT by any authed user (financial data).
-- Lock both to admin/assistant (mirror expense_transactions).

-- ─── sponsor_reads ───────────────────────────────────────────────────────
drop policy if exists "Authenticated users can select sponsor_reads" on public.sponsor_reads;
drop policy if exists "Authenticated users can insert sponsor_reads" on public.sponsor_reads;
drop policy if exists "Authenticated users can update sponsor_reads" on public.sponsor_reads;
drop policy if exists "Authenticated users can delete sponsor_reads" on public.sponsor_reads;

create policy "Admin/assistant read sponsor_reads"
  on public.sponsor_reads for select
  using (public.is_admin_or_assistant(auth.uid()));

create policy "Admin/assistant write sponsor_reads"
  on public.sponsor_reads for insert
  with check (public.is_admin_or_assistant(auth.uid()));

create policy "Admin/assistant update sponsor_reads"
  on public.sponsor_reads for update
  using (public.is_admin_or_assistant(auth.uid()))
  with check (public.is_admin_or_assistant(auth.uid()));

create policy "Admin/assistant delete sponsor_reads"
  on public.sponsor_reads for delete
  using (public.is_admin_or_assistant(auth.uid()));

-- ─── revenue_transactions ────────────────────────────────────────────────
drop policy if exists "Authenticated users can read revenue_transactions" on public.revenue_transactions;

create policy "Admin read revenue_transactions"
  on public.revenue_transactions for select
  using (public.is_admin(auth.uid()));
