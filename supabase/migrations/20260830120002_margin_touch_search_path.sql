-- Pin the search_path on the Breakdown updated_at trigger function.
--
-- Supabase's security advisor flags `function_search_path_mutable`: without an
-- explicit search_path, the function resolves unqualified names against
-- whatever the caller's path happens to be. It is a low-severity lint here —
-- the body only touches NEW — but it is free to close, and the newer helpers in
-- this schema (is_admin, is_strict_admin) already pin theirs.
--
-- Several older *_touch_updated_at functions carry the same lint. Left alone:
-- this migration only cleans up what the Breakdown work introduced.

create or replace function public.margin_touch_updated_at()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
