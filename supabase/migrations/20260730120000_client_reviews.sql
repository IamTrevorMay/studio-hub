-- Client Portal part 3: review loop.
-- Links reviews to contractor_assignments, adds per-version client verdicts,
-- and REWRITES the reviews-family RLS (previously wide open: every table had
-- SELECT USING(true) for all authenticated; reviews/review_comments even had
-- UPDATE USING(true)). Staff behavior is preserved via is_staff(); clients and
-- contractors get scoped access through the linked assignment.

-- 1. Schema.
alter table public.reviews
  add column if not exists assignment_id uuid references public.contractor_assignments(id) on delete cascade;
create index if not exists reviews_assignment_id_idx on public.reviews(assignment_id);

alter table public.review_versions
  add column if not exists client_verdict text check (client_verdict in ('changes_requested','approved')),
  add column if not exists client_verdict_at timestamptz,
  add column if not exists client_verdict_by uuid references public.profiles(id);

-- 2. Recursion-safe helpers.
create or replace function public.review_client_id(p_review uuid)
returns uuid
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select a.created_by from reviews r
  join contractor_assignments a on a.id = r.assignment_id
  where r.id = p_review and public.is_client(a.created_by);
$$;

create or replace function public.review_contractor_id(p_review uuid)
returns uuid
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select a.contractor_id from reviews r
  join contractor_assignments a on a.id = r.assignment_id
  where r.id = p_review;
$$;

create or replace function public.can_view_review(p_review uuid, p_uid uuid)
returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select public.is_staff(p_uid)
      or public.review_client_id(p_review) = p_uid
      or public.review_contractor_id(p_review) = p_uid;
$$;

create or replace function public.review_id_for_comment(p_comment uuid)
returns uuid
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select review_id from review_comments where id = p_comment;
$$;

revoke execute on function public.review_client_id(uuid) from anon;
revoke execute on function public.review_contractor_id(uuid) from anon;
revoke execute on function public.can_view_review(uuid, uuid) from anon;
revoke execute on function public.review_id_for_comment(uuid) from anon;

-- 3. Drop the wide-open live policies (names verified against pg_policies).
drop policy if exists "Authenticated users can create reviews" on public.reviews;
drop policy if exists "Authenticated users can update reviews" on public.reviews;
drop policy if exists "Authenticated users can view reviews" on public.reviews;
drop policy if exists "Creator and admins can delete reviews" on public.reviews;

drop policy if exists "Authenticated users can create versions" on public.review_versions;
drop policy if exists "Authenticated users can view versions" on public.review_versions;
drop policy if exists "Creator and admins can delete versions" on public.review_versions;

drop policy if exists "Authenticated users can create review comments" on public.review_comments;
drop policy if exists "Authenticated users can update review comments" on public.review_comments;
drop policy if exists "Authenticated users can view review comments" on public.review_comments;
drop policy if exists "Owner and admins can delete review comments" on public.review_comments;

drop policy if exists "Authenticated users can create replies" on public.review_replies;
drop policy if exists "Authenticated users can view replies" on public.review_replies;
drop policy if exists "Owner and admins can delete replies" on public.review_replies;

drop policy if exists "Authenticated users can insert thumbnails" on public.review_thumbnails;
drop policy if exists "Authenticated users can view thumbnails" on public.review_thumbnails;
drop policy if exists "Users can delete own thumbnails" on public.review_thumbnails;

drop policy if exists "Authenticated users can insert titles" on public.review_titles;
drop policy if exists "Authenticated users can view titles" on public.review_titles;
drop policy if exists "Users can delete own titles" on public.review_titles;

drop policy if exists "Authenticated users can insert detail comments" on public.review_details_comments;
drop policy if exists "Authenticated users can view detail comments" on public.review_details_comments;
drop policy if exists "Users can delete own detail comments" on public.review_details_comments;

-- 4. Scoped policies.

-- reviews
create policy "review select" on public.reviews for select
  using (public.can_view_review(id, auth.uid()));
create policy "review insert" on public.reviews for insert
  with check (created_by = auth.uid() and (
    public.is_staff(auth.uid())
    or (assignment_id is not null and exists (
          select 1 from public.contractor_assignments a
          where a.id = assignment_id and a.contractor_id = auth.uid()))));
create policy "review update" on public.reviews for update
  using (public.is_staff(auth.uid()) or created_by = auth.uid())
  with check (public.is_staff(auth.uid()) or created_by = auth.uid());
create policy "review delete" on public.reviews for delete
  using (public.is_admin(auth.uid()) or created_by = auth.uid());

-- Non-staff cannot re-point a review at a different assignment after creation.
create or replace function public.review_lock_assignment_link()
returns trigger
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if NEW.assignment_id is distinct from OLD.assignment_id
     and not public.is_staff(auth.uid()) then
    raise exception 'Only staff may re-link a review to a different assignment';
  end if;
  return NEW;
end;
$$;
create trigger review_lock_assignment_link_trg
  before update on public.reviews
  for each row execute function public.review_lock_assignment_link();

-- review_versions
create policy "review_versions select" on public.review_versions for select
  using (public.can_view_review(review_id, auth.uid()));
create policy "review_versions insert" on public.review_versions for insert
  with check (created_by = auth.uid() and (
    public.is_staff(auth.uid())
    or public.review_contractor_id(review_id) = auth.uid()));
create policy "review_versions update" on public.review_versions for update
  using (public.is_staff(auth.uid()) or created_by = auth.uid())
  with check (public.is_staff(auth.uid()) or created_by = auth.uid());
create policy "review_versions delete" on public.review_versions for delete
  using (public.is_admin(auth.uid()) or created_by = auth.uid());

-- Verdict columns: only the review's client (via submit_review_verdict, which
-- runs as definer but keeps auth.uid()) or staff may change them, and the
-- client path may change nothing else. Contractors cannot self-approve.
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
  if auth.uid() = public.review_client_id(NEW.review_id) and not other_changed then
    return NEW;
  end if;
  raise exception 'Only the client may set the review verdict';
end;
$$;
create trigger review_version_verdict_guard_trg
  before update on public.review_versions
  for each row execute function public.review_version_verdict_guard();

-- review_comments (closes the live UPDATE USING(true) hole)
create policy "review_comments select" on public.review_comments for select
  using (public.can_view_review(review_id, auth.uid()));
create policy "review_comments insert" on public.review_comments for insert
  with check (user_id = auth.uid() and public.can_view_review(review_id, auth.uid()));
create policy "review_comments update" on public.review_comments for update
  using (public.can_view_review(review_id, auth.uid()))
  with check (public.can_view_review(review_id, auth.uid()));
create policy "review_comments delete" on public.review_comments for delete
  using (public.is_admin(auth.uid()) or user_id = auth.uid());

-- review_replies
create policy "review_replies select" on public.review_replies for select
  using (public.can_view_review(public.review_id_for_comment(comment_id), auth.uid()));
create policy "review_replies insert" on public.review_replies for insert
  with check (user_id = auth.uid()
    and public.can_view_review(public.review_id_for_comment(comment_id), auth.uid()));
create policy "review_replies delete" on public.review_replies for delete
  using (public.is_admin(auth.uid()) or user_id = auth.uid());

-- review_thumbnails
create policy "review_thumbnails select" on public.review_thumbnails for select
  using (public.can_view_review(review_id, auth.uid()));
create policy "review_thumbnails insert" on public.review_thumbnails for insert
  with check (uploaded_by = auth.uid() and public.can_view_review(review_id, auth.uid()));
create policy "review_thumbnails delete" on public.review_thumbnails for delete
  using (public.is_admin(auth.uid()) or uploaded_by = auth.uid());

-- review_titles
create policy "review_titles select" on public.review_titles for select
  using (public.can_view_review(review_id, auth.uid()));
create policy "review_titles insert" on public.review_titles for insert
  with check (created_by = auth.uid() and public.can_view_review(review_id, auth.uid()));
create policy "review_titles delete" on public.review_titles for delete
  using (public.is_admin(auth.uid()) or created_by = auth.uid());

-- review_details_comments
create policy "review_details_comments select" on public.review_details_comments for select
  using (public.can_view_review(review_id, auth.uid()));
create policy "review_details_comments insert" on public.review_details_comments for insert
  with check (user_id = auth.uid() and public.can_view_review(review_id, auth.uid()));
create policy "review_details_comments delete" on public.review_details_comments for delete
  using (public.is_admin(auth.uid()) or user_id = auth.uid());

-- 5. Verdict RPC ("Submit Changes" / "This looks great!").
create or replace function public.submit_review_verdict(p_version_id uuid, p_verdict text)
returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v record;
begin
  if p_verdict not in ('changes_requested','approved') then
    raise exception 'invalid verdict';
  end if;
  select rv.id, rv.review_id, rv.version_number, rv.label,
         a.created_by as client_id, a.contractor_id, a.title as assignment_title
    into v
    from review_versions rv
    join reviews r on r.id = rv.review_id
    join contractor_assignments a on a.id = r.assignment_id
   where rv.id = p_version_id;
  if not found or v.client_id is distinct from auth.uid() then
    raise exception 'not authorized';
  end if;
  update review_versions
     set client_verdict = p_verdict,
         client_verdict_at = now(),
         client_verdict_by = auth.uid()
   where id = p_version_id;
  if v.contractor_id is not null then
    insert into notifications (user_id, type, title, body, link_tab, link_target)
    values (v.contractor_id, 'fl_review_feedback',
            case p_verdict when 'approved' then 'Client approved your cut'
                           else 'Client requested changes' end,
            '"' || v.assignment_title || '" (' || coalesce(v.label, 'v' || v.version_number) || ')',
            'fl_reviews', v.review_id::text);
  end if;
end;
$$;
revoke execute on function public.submit_review_verdict(uuid, text) from anon;

-- 6. New cut ready -> notify the client.
create or replace function public.review_version_notify_client()
returns trigger
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_client uuid;
  v_title text;
begin
  select a.created_by, a.title into v_client, v_title
    from reviews r
    join contractor_assignments a on a.id = r.assignment_id
   where r.id = NEW.review_id;
  if v_client is not null and public.is_client(v_client) and NEW.created_by is distinct from v_client then
    insert into notifications (user_id, type, title, body, link_tab, link_target)
    values (v_client, 'cl_review_ready', 'New cut ready for review',
            '"' || v_title || '" ' || coalesce(NEW.label, 'v' || NEW.version_number) || ' is ready.',
            'cl_review', NEW.review_id::text);
  end if;
  return NEW;
end;
$$;
create trigger review_version_notify_client_trg
  after insert on public.review_versions
  for each row execute function public.review_version_notify_client();

notify pgrst, 'reload schema';
