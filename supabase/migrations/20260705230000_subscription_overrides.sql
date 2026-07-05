-- Manual overrides for the auto-detected Subscriptions view on the Accounting
-- page. Detection groups recurring expenses by exact description; overrides
-- let an admin merge descriptor variants of the same service into one line
-- (kind='merge') or dismiss a false positive (kind='hide').
-- member_keys entries are '<business>|<description>' — the detection group key.

create table if not exists subscription_overrides (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('merge', 'hide')),
  name text,                    -- display name for merged groups
  member_keys text[] not null,  -- merge: 2+ keys; hide: single key
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now()
);

alter table subscription_overrides enable row level security;
drop policy if exists subscription_overrides_admin_all on subscription_overrides;
create policy subscription_overrides_admin_all on subscription_overrides
  for all to authenticated using (is_admin()) with check (is_admin());
