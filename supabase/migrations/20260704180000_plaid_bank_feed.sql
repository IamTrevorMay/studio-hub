-- Plaid direct bank feed — replaces Tiller ingestion for Accounting.
-- New tables: plaid_items, linked_accounts, category_rules, account_balances.
-- Extends revenue_transactions / expense_transactions with source tracking,
-- review workflow, and transfer flagging. Tiller history rows keep working
-- via column defaults (source='tiller', review_status='confirmed').

-- ── 1. plaid_items — one row per bank connection ─────────────
-- access_token is service-role-only: RLS enabled with NO policies.
create table if not exists plaid_items (
  id uuid primary key default gen_random_uuid(),
  item_id text unique not null,
  access_token text not null,
  institution_id text,
  institution_name text,
  status text not null default 'ok' check (status in ('ok','error','relink_required')),
  error_code text,
  sync_cursor text,
  last_synced_at timestamptz,
  created_at timestamptz default now()
);
alter table plaid_items enable row level security;

-- ── 2. linked_accounts — bank account ↔ business mapping ─────
create table if not exists linked_accounts (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references plaid_items(id) on delete cascade,
  plaid_account_id text unique not null,
  name text,
  mask text,
  account_type text,
  account_subtype text,
  business text not null check (business in ('mayday_media','neptune_performance')),
  is_active boolean not null default true,
  created_at timestamptz default now()
);
alter table linked_accounts enable row level security;
drop policy if exists linked_accounts_admin_select on linked_accounts;
create policy linked_accounts_admin_select on linked_accounts
  for select to authenticated using (is_admin());
drop policy if exists linked_accounts_admin_update on linked_accounts;
create policy linked_accounts_admin_update on linked_accounts
  for update to authenticated using (is_admin()) with check (is_admin());

-- ── 3. category_rules — merchant pattern → category ──────────
create table if not exists category_rules (
  id uuid primary key default gen_random_uuid(),
  pattern text not null,
  match_type text not null default 'contains' check (match_type in ('contains','exact')),
  txn_kind text not null check (txn_kind in ('revenue','expense')),
  category text not null,
  business text check (business in ('mayday_media','neptune_performance')),
  priority integer not null default 0,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now()
);
alter table category_rules enable row level security;
drop policy if exists category_rules_admin_all on category_rules;
create policy category_rules_admin_all on category_rules
  for all to authenticated using (is_admin()) with check (is_admin());

-- ── 4. account_balances — per-sync balance snapshots ─────────
create table if not exists account_balances (
  id uuid primary key default gen_random_uuid(),
  linked_account_id uuid not null references linked_accounts(id) on delete cascade,
  balance_cents bigint,
  available_cents bigint,
  snapshot_date date not null,
  created_at timestamptz default now(),
  unique (linked_account_id, snapshot_date)
);
alter table account_balances enable row level security;
drop policy if exists account_balances_admin_select on account_balances;
create policy account_balances_admin_select on account_balances
  for select to authenticated using (is_admin());

-- ── 5. transaction table extensions ──────────────────────────
alter table revenue_transactions
  add column if not exists source text not null default 'tiller' check (source in ('tiller','plaid','manual')),
  add column if not exists plaid_transaction_id text,
  add column if not exists linked_account_id uuid references linked_accounts(id) on delete set null,
  add column if not exists review_status text not null default 'confirmed' check (review_status in ('auto','confirmed')),
  add column if not exists categorized_by text not null default 'tiller' check (categorized_by in ('tiller','rule','ai','manual')),
  add column if not exists is_transfer boolean not null default false;

alter table expense_transactions
  add column if not exists source text not null default 'tiller' check (source in ('tiller','plaid','manual')),
  add column if not exists plaid_transaction_id text,
  add column if not exists linked_account_id uuid references linked_accounts(id) on delete set null,
  add column if not exists review_status text not null default 'confirmed' check (review_status in ('auto','confirmed')),
  add column if not exists categorized_by text not null default 'tiller' check (categorized_by in ('tiller','rule','ai','manual')),
  add column if not exists is_transfer boolean not null default false;

-- Plaid txn ids must be unique when present (dedup across sync runs).
create unique index if not exists revenue_transactions_plaid_txn_uq
  on revenue_transactions (plaid_transaction_id) where plaid_transaction_id is not null;
create unique index if not exists expense_transactions_plaid_txn_uq
  on expense_transactions (plaid_transaction_id) where plaid_transaction_id is not null;

-- Review-inbox lookups (rows awaiting confirmation are a small subset).
create index if not exists revenue_transactions_review_idx
  on revenue_transactions (review_status) where review_status = 'auto';
create index if not exists expense_transactions_review_idx
  on expense_transactions (review_status) where review_status = 'auto';

-- Admins can correct category/review fields from the review inbox.
drop policy if exists revenue_transactions_admin_update on revenue_transactions;
create policy revenue_transactions_admin_update on revenue_transactions
  for update to authenticated using (is_admin()) with check (is_admin());
drop policy if exists expense_transactions_admin_update on expense_transactions;
create policy expense_transactions_admin_update on expense_transactions
  for update to authenticated using (is_admin()) with check (is_admin());
