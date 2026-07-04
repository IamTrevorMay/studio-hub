-- Admin-readable health view over plaid_items. The base table stays
-- service-role-only (it holds access tokens); this exposes only safe columns.
-- security_invoker=off + in-view is_admin() filter is the standard way to
-- surface a locked table's metadata.
drop view if exists plaid_items_health;
create view plaid_items_health with (security_invoker = off) as
  select id, institution_name, status, error_code, last_synced_at, created_at
  from plaid_items
  where is_admin();
grant select on plaid_items_health to authenticated;
