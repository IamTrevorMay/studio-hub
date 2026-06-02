-- Bug fix: previous sync_campaign_fully_delivered cleared fully_delivered_at
-- on ANY insert of an undelivered deliverable into an already-fully-delivered
-- campaign, restarting the 45-day Late payment clock. The historical
-- "fully delivered" stamp should only clear when a previously-delivered row
-- regresses (UPDATE delivered:true→false or DELETE of a delivered row).
-- Also adds SET search_path hardening.

create or replace function public.sync_campaign_fully_delivered()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cid uuid;
  total int;
  delivered_count int;
  may_clear boolean := false;
begin
  cid := coalesce(NEW.campaign_id, OLD.campaign_id);
  if cid is null then return coalesce(NEW, OLD); end if;

  if TG_OP = 'DELETE' and OLD.delivered is true then
    may_clear := true;
  elsif TG_OP = 'UPDATE' and OLD.delivered is true and NEW.delivered is not true then
    may_clear := true;
  end if;

  select count(*), count(*) filter (where delivered)
    into total, delivered_count
  from public.sponsor_deliverables where campaign_id = cid;

  if total > 0 and total = delivered_count then
    update public.sponsor_campaigns
      set fully_delivered_at = coalesce(fully_delivered_at, now())
      where id = cid;
  elsif may_clear then
    update public.sponsor_campaigns
      set fully_delivered_at = null
      where id = cid and fully_delivered_at is not null;
  end if;

  return coalesce(NEW, OLD);
end;
$$;
