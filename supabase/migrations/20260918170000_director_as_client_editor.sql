-- The Director of Production can be linked to a client as an editor
-- (client_editors), alongside contractors with the Editor sub-role.
-- 'creative' is the legacy value of that director sub-role.
create or replace function public.client_editors_validate()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from profiles where id = NEW.client_id and role = 'client') then
    raise exception 'client_id must be a client profile';
  end if;
  if not exists (
    select 1 from profiles p
    where p.id = NEW.contractor_id
      and (
        (p.role = 'contractor'
          and p.sub_role in ('Editor','Long Form Editor','Short Form Editor','Short-Form Video Editor','Podcast Editor'))
        or (p.role = 'director' and p.sub_role in ('production','creative'))
      )
  ) then
    raise exception 'contractor_id must be an Editor contractor or the Director of Production';
  end if;
  return NEW;
end;
$$;
