-- Admin-tier RLS parity sweep.
--
-- The 2026-07-29 role restructure split the old single `admin` role into the
-- admin tier (admin + director), and `is_admin()` was introduced to express it.
-- The 2026-08-11 parity migration converted a batch of tables, but ~130 policies
-- across the rest of the schema were missed and still test the literal
-- `profiles.role = 'admin'`. Every page behind them gates on the client-side
-- admin-tier `isAdmin`, so a director sees the UI and then hits an RLS error on
-- write — Goals/Tracking being the case that surfaced this.
--
-- This rewrites those policies in place to call is_admin(). It is mechanical:
-- the predicate text is pulled from pg_policies and the recognised
-- role = 'admin' shapes are substituted, so no policy is retyped by hand and
-- nothing else in a compound predicate changes.
--
-- DELIBERATELY NOT TOUCHED:
--   * public.profiles — its policies already use is_strict_admin()/is_admin()
--     correctly. They are the self-promotion guard that stops a director from
--     editing admin-tier accounts, and must stay strict.
--   * Policies testing `role = ANY (ARRAY['admin','director','member'])`
--     (project_card_notes / project_card_handoffs) — already staff-wide.
--
-- Shapes rewritten:
--   EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid()
--           AND profiles.role = 'admin')            -- with or without alias p
--   (SELECT profiles.role FROM profiles WHERE profiles.id = auth.uid()) = 'admin'
--   created_by IN (SELECT profiles.id FROM profiles WHERE profiles.role = 'admin')
--
-- That last shape is monthly_goals only, and it was a genuine security hole
-- rather than a tier mismatch: it tested whether the ROW's creator was an
-- admin, never who the caller was, so any authenticated user — contractor or
-- client included — could update or delete a monthly goal that an admin had
-- created. Rewriting it to is_admin() fixes the escalation as well as the tier.

do $$
declare
  r         record;
  new_qual  text;
  new_check text;
  stmt      text;
  n         int := 0;
  leftovers int;
begin
  for r in
    select tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and tablename <> 'profiles'
      and (coalesce(qual,'') like '%''admin''::text%'
           or coalesce(with_check,'') like '%''admin''::text%')
      and coalesce(qual,'')       not like '%role = ANY%'
      and coalesce(with_check,'') not like '%role = ANY%'
    order by tablename, policyname
  loop
    -- Apply all three shapes to both predicates.
    new_qual := regexp_replace(
                  regexp_replace(
                    regexp_replace(coalesce(r.qual,''),
                      'EXISTS \( SELECT 1\s+FROM profiles( p)?\s+WHERE \(\((profiles|p)\.id = auth\.uid\(\)\) AND \((profiles|p)\.role = ''admin''::text\)\)\)',
                      'is_admin()', 'g'),
                    '\( SELECT profiles\.role\s+FROM profiles\s+WHERE \(profiles\.id = auth\.uid\(\)\)\) = ''admin''::text',
                    'is_admin()', 'g'),
                  'created_by IN \( SELECT profiles\.id\s+FROM profiles\s+WHERE \(profiles\.role = ''admin''::text\)\)',
                  'is_admin()', 'g');

    new_check := regexp_replace(
                   regexp_replace(
                     regexp_replace(coalesce(r.with_check,''),
                       'EXISTS \( SELECT 1\s+FROM profiles( p)?\s+WHERE \(\((profiles|p)\.id = auth\.uid\(\)\) AND \((profiles|p)\.role = ''admin''::text\)\)\)',
                       'is_admin()', 'g'),
                     '\( SELECT profiles\.role\s+FROM profiles\s+WHERE \(profiles\.id = auth\.uid\(\)\)\) = ''admin''::text',
                     'is_admin()', 'g'),
                   'created_by IN \( SELECT profiles\.id\s+FROM profiles\s+WHERE \(profiles\.role = ''admin''::text\)\)',
                   'is_admin()', 'g');

    -- Never half-convert: if a shape wasn't recognised, leave the policy
    -- alone and let the assertion below fail loudly.
    if new_qual like '%''admin''::text%' or new_check like '%''admin''::text%' then
      raise warning 'Unrecognised admin predicate on %.% — left unchanged', r.tablename, r.policyname;
      continue;
    end if;

    stmt := format('alter policy %I on public.%I', r.policyname, r.tablename);
    if coalesce(r.qual,'') <> ''       then stmt := stmt || format(' using (%s)', new_qual); end if;
    if coalesce(r.with_check,'') <> '' then stmt := stmt || format(' with check (%s)', new_check); end if;

    execute stmt;
    n := n + 1;
  end loop;

  raise notice 'admin-tier parity: rewrote % policies', n;

  -- Self-check: nothing outside profiles / the staff-array policies may still
  -- test the literal role.
  select count(*) into leftovers
  from pg_policies
  where schemaname = 'public'
    and tablename <> 'profiles'
    and (coalesce(qual,'') like '%''admin''::text%'
         or coalesce(with_check,'') like '%''admin''::text%')
    and coalesce(qual,'')       not like '%role = ANY%'
    and coalesce(with_check,'') not like '%role = ANY%';

  if leftovers > 0 then
    raise exception 'admin-tier parity incomplete: % policies still test role = ''admin''', leftovers;
  end if;
end $$;
