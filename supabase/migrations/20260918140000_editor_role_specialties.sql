-- Contractor roles: condense the three editor titles into one `Editor`
-- sub-role and add `specialties` for the context that used to live in the
-- title.
--
--   Long Form Editor          → Editor + {long_form}
--   Short Form Editor         → Editor + {social_video}
--   Short-Form Video Editor   → Editor + {social_video}   (one legacy row)
--   Podcast Editor            → Editor + {audio_podcast}
--
-- Specialties (multi-select, any contractor sub-role): long_form,
-- social_video, audio_podcast, graphic_design, sound_design, color_correction.
-- Mirrors CONTRACTOR_SPECIALTIES in src/lib/rolePermissions.js — keep in sync.
--
-- Margin products that matched on an editor title now match on
-- sub_role = 'Editor' plus a new `match_specialty`, so "YouTube long-form" and
-- "Short-form / social clip" keep routing to the right people.

-- ── Columns ─────────────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists specialties text[] not null default '{}';
alter table public.profiles drop constraint if exists profiles_specialties_allowed;
alter table public.profiles add constraint profiles_specialties_allowed check (
  specialties <@ array['long_form','social_video','audio_podcast','graphic_design','sound_design','color_correction']::text[]
);
comment on column public.profiles.specialties is
  'Contractor specialties (context on top of sub_role). Admin-set. Values mirror CONTRACTOR_SPECIALTIES.';

alter table public.invitations
  add column if not exists specialties text[] not null default '{}';

alter table public.margin_products
  add column if not exists match_specialty text;
comment on column public.margin_products.match_specialty is
  'Optional: only contractors whose profiles.specialties contains this value match (used with match_sub_role = Editor).';

-- ── Data: profiles ──────────────────────────────────────────────────────────
update public.profiles
set specialties = (
      select array_agg(distinct v) from unnest(
        specialties || case sub_role
          when 'Long Form Editor'        then array['long_form']
          when 'Short Form Editor'       then array['social_video']
          when 'Short-Form Video Editor' then array['social_video']
          when 'Podcast Editor'          then array['audio_podcast']
          else array[]::text[]
        end
      ) as v
    ),
    sub_role = 'Editor',
    title = 'Editor',
    updated_at = now()
where role = 'contractor'
  and sub_role in ('Long Form Editor','Short Form Editor','Short-Form Video Editor','Podcast Editor');

-- Contractors whose sub_role is null but whose legacy title says editor.
update public.profiles
set specialties = (
      select array_agg(distinct v) from unnest(
        specialties || case title
          when 'Long Form Editor'        then array['long_form']
          when 'Short Form Editor'       then array['social_video']
          when 'Short-Form Video Editor' then array['social_video']
          when 'Podcast Editor'          then array['audio_podcast']
          else array[]::text[]
        end
      ) as v
    ),
    sub_role = 'Editor',
    title = 'Editor',
    updated_at = now()
where role = 'contractor'
  and sub_role is null
  and title in ('Long Form Editor','Short Form Editor','Short-Form Video Editor','Podcast Editor');

-- ── Data: pending invitations ───────────────────────────────────────────────
update public.invitations
set specialties = case coalesce(sub_role, title)
      when 'Long Form Editor'        then array['long_form']
      when 'Short Form Editor'       then array['social_video']
      when 'Short-Form Video Editor' then array['social_video']
      when 'Podcast Editor'          then array['audio_podcast']
      else specialties
    end,
    sub_role = 'Editor',
    title = 'Editor'
where role = 'contractor'
  and accepted_at is null
  and coalesce(sub_role, title) in ('Long Form Editor','Short Form Editor','Short-Form Video Editor','Podcast Editor');

-- ── Data: margin products ───────────────────────────────────────────────────
update public.margin_products
set match_specialty = case match_sub_role
      when 'Long Form Editor'  then 'long_form'
      when 'Short Form Editor' then 'social_video'
      when 'Podcast Editor'    then 'audio_podcast'
    end,
    match_sub_role = 'Editor',
    updated_at = now()
where match_sub_role in ('Long Form Editor','Short Form Editor','Podcast Editor');

-- ── client_editors: editor = the condensed sub-role (legacy values tolerated) ─
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
    select 1 from profiles where id = NEW.contractor_id and role = 'contractor'
      and sub_role in ('Editor','Long Form Editor','Short Form Editor','Short-Form Video Editor','Podcast Editor')
  ) then
    raise exception 'contractor_id must be a contractor with the Editor sub-role';
  end if;
  return NEW;
end;
$$;

-- ── Signup: carry specialties from the invitation onto the new profile ──────
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  invited_role text;
  invited_sub_role text;
  invited_specialties text[];
  meta_role text;
  meta_specialties text[];
  final_role text;
begin
  select i.role, i.sub_role, i.specialties
    into invited_role, invited_sub_role, invited_specialties
  from public.invitations i
  where lower(i.email) = lower(NEW.email)
    and i.role is not null
  order by i.created_at desc
  limit 1;

  -- Only accept a metadata role we recognize: it originates from invite-user's
  -- service-role call, but this keeps an unexpected value from becoming a role.
  meta_role := NULLIF(NEW.raw_user_meta_data->>'role', '');
  if meta_role is not null
     and meta_role not in ('admin', 'director', 'member', 'contractor', 'client') then
    meta_role := null;
  end if;

  final_role := COALESCE(invited_role, meta_role, 'member');

  -- Specialties from metadata (fallback when the invitations lookup misses);
  -- filtered to the allowed list so the check constraint can't reject signup.
  begin
    select array_agg(v) into meta_specialties
    from jsonb_array_elements_text(coalesce(NEW.raw_user_meta_data->'specialties', '[]'::jsonb)) as v
    where v in ('long_form','social_video','audio_podcast','graphic_design','sound_design','color_correction');
  exception when others then
    meta_specialties := null;
  end;

  insert into public.profiles (
    id, full_name, nickname, email, role, title, sub_role, specialties,
    assigned_drive_folder_id, assigned_drive_folder_name
  )
  values (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'nickname', ''),
    NEW.email,
    final_role,
    NULLIF(NEW.raw_user_meta_data->>'title', ''),
    COALESCE(
      invited_sub_role,
      NULLIF(NEW.raw_user_meta_data->>'sub_role', ''),
      case when final_role = 'contractor'
           then NULLIF(NEW.raw_user_meta_data->>'title', '') end
    ),
    case when final_role = 'contractor'
         then COALESCE(invited_specialties, meta_specialties, '{}'::text[])
         else '{}'::text[] end,
    NULLIF(NEW.raw_user_meta_data->>'assigned_drive_folder_id', ''),
    NULLIF(NEW.raw_user_meta_data->>'assigned_drive_folder_name', '')
  )
  on conflict (id) do update
    set email    = EXCLUDED.email,
        nickname = COALESCE(EXCLUDED.nickname, public.profiles.nickname),
        title    = COALESCE(EXCLUDED.title, public.profiles.title),
        sub_role = COALESCE(EXCLUDED.sub_role, public.profiles.sub_role),
        specialties = case when cardinality(EXCLUDED.specialties) > 0 then EXCLUDED.specialties else public.profiles.specialties end,
        assigned_drive_folder_id   = COALESCE(EXCLUDED.assigned_drive_folder_id, public.profiles.assigned_drive_folder_id),
        assigned_drive_folder_name = COALESCE(EXCLUDED.assigned_drive_folder_name, public.profiles.assigned_drive_folder_name);
  return NEW;
end;
$$;

-- ── specialties are admin-set, like sub_role ────────────────────────────────
create or replace function public.profiles_lock_admin_fields()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  -- Service role / SQL contexts carry no JWT — trusted, skip all checks.
  if auth.uid() is null then
    return NEW;
  end if;
  if public.is_strict_admin() then
    return NEW;
  end if;
  -- Strict-admin-only field: even directors (admin-tier) can't flip it.
  if NEW.deactivated_at is distinct from OLD.deactivated_at then
    raise exception 'deactivated_at is strict-admin-only';
  end if;
  if public.is_admin(auth.uid()) then
    return NEW;
  end if;
  if NEW.role is distinct from OLD.role then
    raise exception 'role is admin-only';
  end if;
  if NEW.sub_role is distinct from OLD.sub_role then
    raise exception 'sub_role is admin-only';
  end if;
  if NEW.specialties is distinct from OLD.specialties then
    raise exception 'specialties is admin-only';
  end if;
  if NEW.posting_allowed is distinct from OLD.posting_allowed then
    raise exception 'posting_allowed is admin-only';
  end if;
  if NEW.title is distinct from OLD.title then
    raise exception 'title is admin-only';
  end if;
  if NEW.assigned_drive_folder_id is distinct from OLD.assigned_drive_folder_id then
    raise exception 'assigned_drive_folder_id is admin-only';
  end if;
  if NEW.assigned_drive_folder_name is distinct from OLD.assigned_drive_folder_name then
    raise exception 'assigned_drive_folder_name is admin-only';
  end if;
  return NEW;
end;
$$;
