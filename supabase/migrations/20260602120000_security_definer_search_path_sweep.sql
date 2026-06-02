-- Harden every SECURITY DEFINER function in `public` by pinning its
-- search_path to (public, pg_temp). Without this, a role that can create
-- objects in their own schema could shadow `profiles`, `auth.users`, etc.
-- and trick a SECURITY DEFINER fn into reading the wrong table.

do $$
declare
  r record;
begin
  for r in
    select n.nspname,
           p.proname,
           pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef = true
      and (p.proconfig is null
           or not exists (
             select 1 from unnest(p.proconfig) c where c like 'search_path=%'
           ))
  loop
    execute format(
      'alter function %I.%I(%s) set search_path = public, pg_temp',
      r.nspname, r.proname, r.args
    );
  end loop;
end $$;
