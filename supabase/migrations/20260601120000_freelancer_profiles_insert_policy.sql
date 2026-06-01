-- Allow freelancers to insert their own freelancer_profiles row during account setup.
-- Without this, the upsert in AuthPage.js silently fails and payment_type/rate are never set.
create policy "freelancer insert own profile"
  on public.freelancer_profiles for insert
  with check (id = auth.uid());
