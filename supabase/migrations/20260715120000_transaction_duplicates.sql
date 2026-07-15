-- Duplicate-transaction resolution for the Accounting page.
--
-- Duplicates happen when the same bank line arrives through two feeds (Tiller
-- + Plaid overlap), a CSV import overlaps a feed window, or the tiller_v1
-- historical import overlaps live rows. Rows are never deleted — the sync
-- reconcilers would just re-insert them — they're soft-flagged is_duplicate
-- and excluded from every aggregate, mirroring the is_transfer pattern.

alter table public.revenue_transactions
  add column if not exists is_duplicate boolean not null default false;
alter table public.expense_transactions
  add column if not exists is_duplicate boolean not null default false;

-- Flagged rows are a small subset; the "show resolved" list reads them directly.
create index if not exists revenue_transactions_duplicate_idx
  on public.revenue_transactions (is_duplicate) where is_duplicate = true;
create index if not exists expense_transactions_duplicate_idx
  on public.expense_transactions (is_duplicate) where is_duplicate = true;

-- "Not duplicates" dismissals. group_key is the sorted uids of the candidate
-- group (e.g. 'exp_<id>+exp_<id>') — if a new row later joins the same
-- cluster the key changes, so the group correctly resurfaces for review.
create table if not exists public.duplicate_dismissals (
  id uuid primary key default gen_random_uuid(),
  group_key text unique not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.duplicate_dismissals enable row level security;

create policy duplicate_dismissals_admin_select on public.duplicate_dismissals
  for select to authenticated using (is_admin());
create policy duplicate_dismissals_admin_insert on public.duplicate_dismissals
  for insert to authenticated with check (is_admin());
create policy duplicate_dismissals_admin_delete on public.duplicate_dismissals
  for delete to authenticated using (is_admin());
create policy duplicate_dismissals_service on public.duplicate_dismissals
  for all to service_role using (true) with check (true);
