-- Share a studio review with a client account.
--
-- Until now the only way a client could see a review was indirectly: the review
-- had to hang off a contractor_assignment the client created (see
-- 20260730120000_client_reviews.sql). This adds an explicit share: staff make a
-- review in Reviews.js, hit "Share", pick client accounts, and those clients get
-- the review in their portal Review tab.
--
-- A shared client can watch, comment, reply, resolve, and submit a verdict — the
-- same surface an assignment-linked client already has. They cannot rename or
-- delete the review: the `review update` / `review delete` policies stay
-- staff-or-creator, and a client is neither.

-- 1. Share table.
create table if not exists public.review_client_shares (
  review_id  uuid not null references public.reviews(id) on delete cascade,
  client_id  uuid not null references public.profiles(id) on delete cascade,
  shared_by  uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (review_id, client_id)
);
create index if not exists review_client_shares_client_idx
  on public.review_client_shares(client_id);

alter table public.review_client_shares enable row level security;

-- Staff own the share list; clients may only read their own rows (they need the
-- read so the portal can find which reviews were shared with them).
drop policy if exists "staff manage review shares" on public.review_client_shares;
create policy "staff manage review shares" on public.review_client_shares
  for all using (public.is_staff(auth.uid()))
  with check (public.is_staff(auth.uid()));

drop policy if exists "client reads own review shares" on public.review_client_shares;
create policy "client reads own review shares" on public.review_client_shares
  for select using (client_id = auth.uid());

-- Only real client accounts can be shared with, and shared_by is stamped from
-- the session rather than trusted from the request body.
create or replace function public.review_share_guard()
returns trigger
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not exists (select 1 from profiles where id = NEW.client_id and role = 'client') then
    raise exception 'Reviews can only be shared with client accounts';
  end if;
  if auth.uid() is not null then
    NEW.shared_by := auth.uid();
  end if;
  return NEW;
end;
$$;

drop trigger if exists review_share_guard_trg on public.review_client_shares;
create trigger review_share_guard_trg
  before insert on public.review_client_shares
  for each row execute function public.review_share_guard();

-- 2. Recursion-safe membership helper (mirrors review_client_id/contractor_id).
create or replace function public.is_review_shared_client(p_review uuid, p_uid uuid)
returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (select 1 from review_client_shares
                 where review_id = p_review and client_id = p_uid);
$$;

-- 3. Visibility: a shared client can see the review family.
--    (Replaces the version from 20260730120000; grants are preserved by REPLACE.)
create or replace function public.can_view_review(p_review uuid, p_uid uuid)
returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select public.is_staff(p_uid)
      or public.review_client_id(p_review) = p_uid
      or public.review_contractor_id(p_review) = p_uid
      or public.is_review_shared_client(p_review, p_uid);
$$;

-- 4. Verdict guard: a shared client may set the verdict columns (and nothing
--    else), same as the assignment-linked client.
create or replace function public.review_version_verdict_guard()
returns trigger
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  verdict_changed boolean;
  other_changed boolean;
begin
  verdict_changed :=
       NEW.client_verdict    is distinct from OLD.client_verdict
    or NEW.client_verdict_at is distinct from OLD.client_verdict_at
    or NEW.client_verdict_by is distinct from OLD.client_verdict_by;
  if not verdict_changed then
    return NEW;
  end if;
  if public.is_staff(auth.uid()) then
    return NEW;
  end if;
  other_changed :=
       NEW.review_id        is distinct from OLD.review_id
    or NEW.version_number   is distinct from OLD.version_number
    or NEW.label            is distinct from OLD.label
    or NEW.youtube_url      is distinct from OLD.youtube_url
    or NEW.youtube_video_id is distinct from OLD.youtube_video_id
    or NEW.created_by       is distinct from OLD.created_by;
  if not other_changed
     and (auth.uid() = public.review_client_id(NEW.review_id)
          or public.is_review_shared_client(NEW.review_id, auth.uid())) then
    return NEW;
  end if;
  raise exception 'Only the client may set the review verdict';
end;
$$;

-- 5. Verdict RPC: accepts shared reviews (which may have no assignment at all),
--    and notifies whoever is on the hook — the assigned editor if there is one,
--    otherwise the staff member who created the review.
create or replace function public.submit_review_verdict(p_version_id uuid, p_verdict text)
returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v record;
  v_label text;
  v_subject text;
begin
  if p_verdict not in ('changes_requested','approved') then
    raise exception 'invalid verdict';
  end if;
  select rv.id, rv.review_id, rv.version_number, rv.label,
         r.title as review_title, r.created_by as review_owner,
         a.created_by as client_id, a.contractor_id, a.title as assignment_title
    into v
    from review_versions rv
    join reviews r on r.id = rv.review_id
    left join contractor_assignments a on a.id = r.assignment_id
   where rv.id = p_version_id;
  if not found then
    raise exception 'not authorized';
  end if;
  if (v.client_id is null or v.client_id is distinct from auth.uid())
     and not public.is_review_shared_client(v.review_id, auth.uid()) then
    raise exception 'not authorized';
  end if;

  update review_versions
     set client_verdict = p_verdict,
         client_verdict_at = now(),
         client_verdict_by = auth.uid()
   where id = p_version_id;

  v_label := coalesce(v.label, 'v' || v.version_number);
  v_subject := '"' || coalesce(v.assignment_title, v.review_title, 'Review') || '" (' || v_label || ')';

  if v.contractor_id is not null then
    insert into notifications (user_id, type, title, body, link_tab, link_target)
    values (v.contractor_id, 'fl_review_feedback',
            case p_verdict when 'approved' then 'Client approved your cut'
                           else 'Client requested changes' end,
            v_subject, 'fl_reviews', v.review_id::text);
  elsif v.review_owner is not null and v.review_owner is distinct from auth.uid() then
    insert into notifications (user_id, type, title, body, link_tab, link_target)
    values (v.review_owner, 'cl_review_verdict',
            case p_verdict when 'approved' then 'Client approved your cut'
                           else 'Client requested changes' end,
            v_subject, 'reviews', v.review_id::text);
  end if;
end;
$$;

-- 6. New cut on a shared review -> notify every client it was shared with,
--    on top of the existing assignment-client notification.
create or replace function public.review_version_notify_client()
returns trigger
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_client uuid;
  v_title text;
  v_label text;
  s record;
begin
  select a.created_by, coalesce(a.title, r.title) into v_client, v_title
    from reviews r
    left join contractor_assignments a on a.id = r.assignment_id
   where r.id = NEW.review_id;
  v_label := coalesce(NEW.label, 'v' || NEW.version_number);

  if v_client is not null and public.is_client(v_client) and NEW.created_by is distinct from v_client then
    insert into notifications (user_id, type, title, body, link_tab, link_target)
    values (v_client, 'cl_review_ready', 'New cut ready for review',
            '"' || coalesce(v_title, 'Review') || '" ' || v_label || ' is ready.',
            'cl_review', NEW.review_id::text);
  end if;

  for s in select client_id from review_client_shares where review_id = NEW.review_id loop
    if s.client_id is distinct from v_client and s.client_id is distinct from NEW.created_by then
      insert into notifications (user_id, type, title, body, link_tab, link_target)
      values (s.client_id, 'cl_review_ready', 'New cut ready for review',
              '"' || coalesce(v_title, 'Review') || '" ' || v_label || ' is ready.',
              'cl_review', NEW.review_id::text);
    end if;
  end loop;

  return NEW;
end;
$$;

-- 7. Sharing itself notifies the client.
create or replace function public.review_share_notify()
returns trigger
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_title text;
begin
  select title into v_title from reviews where id = NEW.review_id;
  insert into notifications (user_id, type, title, body, link_tab, link_target)
  values (NEW.client_id, 'cl_review_ready', 'A video was shared with you',
          '"' || coalesce(v_title, 'Review') || '" is ready for your review.',
          'cl_review', NEW.review_id::text);
  return NEW;
end;
$$;

drop trigger if exists review_share_notify_trg on public.review_client_shares;
create trigger review_share_notify_trg
  after insert on public.review_client_shares
  for each row execute function public.review_share_notify();

-- 8. Grants — same shape as 20260730160000_client_fn_grants.sql. New helpers are
--    only ever called from inside SECURITY DEFINER code or triggers, so no
--    caller needs EXECUTE.
revoke execute on function public.is_review_shared_client(uuid, uuid) from public, anon, authenticated;
grant execute on function public.is_review_shared_client(uuid, uuid) to service_role;
revoke execute on function public.review_share_guard() from public, anon, authenticated;
revoke execute on function public.review_share_notify() from public, anon, authenticated;

notify pgrst, 'reload schema';
