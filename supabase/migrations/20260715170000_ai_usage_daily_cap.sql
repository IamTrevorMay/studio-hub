-- H4: per-user daily AI-usage cap for cost-bearing edge functions.
-- Applied to prod via MCP apply_migration 2026-07-15. Kept here for the git record.
--
-- find-assets-enrich (Claude 8192 tok + billable web_search) and organize-autotag
-- (Claude per item) were reachable by any non-agency authenticated user with no
-- per-user rate limit — a leaked/low-trust token could loop either to run up an
-- Anthropic bill. This adds an atomic per-user, per-day counter enforced in-DB.

create table if not exists public.ai_usage (
  user_id uuid not null references public.profiles(id) on delete cascade,
  fn      text not null,
  day     date not null default (now() at time zone 'America/Los_Angeles')::date,
  count   int  not null default 0,
  primary key (user_id, fn, day)
);
alter table public.ai_usage enable row level security;
-- No client policies: written only through the SECURITY DEFINER bump function below.
-- Service role bypasses RLS; add an admin read policy later if surfaced in UI.

-- Atomically increment the caller's counter for today (PT) and report whether they
-- are still under the per-function daily limit. Uses auth.uid() internally so a
-- caller can only ever bump their OWN counter; limits live here, not in the client.
create or replace function public.bump_ai_usage(p_fn text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  lim int := case p_fn
    when 'find-assets-enrich' then 40
    when 'organize-autotag'   then 60
    else 30
  end;
  d date := (now() at time zone 'America/Los_Angeles')::date;
  new_count int;
begin
  if uid is null then
    return false;  -- no anonymous / service-role usage through this path
  end if;
  insert into public.ai_usage (user_id, fn, day, count)
  values (uid, p_fn, d, 1)
  on conflict (user_id, fn, day)
  do update set count = public.ai_usage.count + 1
  returning count into new_count;
  return new_count <= lim;
end;
$$;
revoke all on function public.bump_ai_usage(text) from public;
grant execute on function public.bump_ai_usage(text) to authenticated;
