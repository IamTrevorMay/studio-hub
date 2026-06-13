-- Atomic counter bump on mailer_campaigns.stats. Webhook + tracker
-- endpoints call this so two concurrent events can't lose an update
-- the way a read-modify-write from the function would.
create or replace function public.mailer_bump_stat(p_campaign_id uuid, p_key text)
returns void
language sql
security definer
set search_path = public as $$
  update public.mailer_campaigns
  set stats = jsonb_set(
    coalesce(stats, '{}'::jsonb),
    array[p_key],
    to_jsonb(coalesce((stats->>p_key)::int, 0) + 1)
  )
  where id = p_campaign_id;
$$;
revoke all on function public.mailer_bump_stat(uuid, text) from public;
grant execute on function public.mailer_bump_stat(uuid, text) to service_role;
