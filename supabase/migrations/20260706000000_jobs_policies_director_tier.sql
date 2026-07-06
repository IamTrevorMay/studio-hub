-- Director-tier roles couldn't write to jobs tables: the jobs policies
-- (20260531000000_jobs.sql) hardcode role = 'admin' instead of using the
-- is_admin() helper, so director_comms/director_creative pass the UI gate
-- but fail RLS ("new row violates row-level security policy").
--
-- Fix 1: bring the zero-arg is_admin() in line with is_admin(uid), which
-- was updated for director roles in 20260602140000_director_roles.sql.
-- Fix 2: recreate the four jobs policies on top of is_admin(auth.uid()).

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('admin', 'director_creative', 'director_comms')
  );
$$;

drop policy if exists job_listings_admin_all on public.job_listings;
create policy job_listings_admin_all on public.job_listings
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists job_applications_admin_all on public.job_applications;
create policy job_applications_admin_all on public.job_applications
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists job_onboarding_admin_all on public.job_onboarding;
create policy job_onboarding_admin_all on public.job_onboarding
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists job_resumes_admin_read on storage.objects;
create policy job_resumes_admin_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'job-resumes'
    and public.is_admin(auth.uid())
  );
