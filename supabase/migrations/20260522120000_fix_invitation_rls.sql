-- Fix invitations RLS: allow invited users to read & accept their own invitation.
-- Previously only admins could SELECT/INSERT/DELETE, and there was no UPDATE policy at all.
-- This caused the role fallback in AuthPage.handleSetup to fail silently,
-- defaulting every invited user to 'member' regardless of the role set at invite time.

-- Users can read invitations addressed to their own email
create policy "Users can read own invitation"
  on invitations for select
  to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email'));

-- Users can mark their own invitation as accepted
create policy "Users can accept own invitation"
  on invitations for update
  to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email'))
  with check (lower(email) = lower(auth.jwt() ->> 'email'));
