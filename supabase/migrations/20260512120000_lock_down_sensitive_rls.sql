-- Critical RLS lockdowns from 2026-05-12 security pass.

-- 1. platform_accounts: hide the `credentials` column from authenticated users.
--    Row-level SELECT policy stays as-is so the frontend can list accounts,
--    but column-level grant blocks reading the secrets JSON. Service role
--    bypasses this.
REVOKE SELECT (credentials) ON public.platform_accounts FROM authenticated;
REVOKE SELECT (credentials) ON public.platform_accounts FROM anon;

-- 2. revenue_events: drop blanket authenticated write policies; restrict to admins.
DROP POLICY IF EXISTS "Authenticated users can insert revenue_events" ON public.revenue_events;
DROP POLICY IF EXISTS "Authenticated users can update revenue_events" ON public.revenue_events;
DROP POLICY IF EXISTS "Authenticated users can delete revenue_events" ON public.revenue_events;

CREATE POLICY "Admins can insert revenue_events"
  ON public.revenue_events FOR INSERT TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins can update revenue_events"
  ON public.revenue_events FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins can delete revenue_events"
  ON public.revenue_events FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()));

-- 3. ad_read_proposals: scope INSERT to self; UPDATE to admin or creator-pending.
DROP POLICY IF EXISTS "Authenticated users can create proposals" ON public.ad_read_proposals;
DROP POLICY IF EXISTS "Authenticated users can update proposals" ON public.ad_read_proposals;

CREATE POLICY "Users create their own proposals"
  ON public.ad_read_proposals FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Admins update any proposal; creators update their own pending"
  ON public.ad_read_proposals FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()) OR (auth.uid() = created_by AND status = 'pending'))
  WITH CHECK (public.is_admin(auth.uid()) OR (auth.uid() = created_by AND status = 'pending'));

-- 4. beat_sheet_versions: only saver may attribute writes to themselves.
DROP POLICY IF EXISTS "Authenticated users can insert beat sheet versions" ON public.beat_sheet_versions;

CREATE POLICY "Users insert versions attributed to themselves"
  ON public.beat_sheet_versions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = saved_by);

-- 5. gmail_connections: drop the inadvertently-public "service role" policy.
--    Service role bypasses RLS already; the per-user SELECT policy remains.
DROP POLICY IF EXISTS "Service role full access on gmail_connections" ON public.gmail_connections;

-- 6. Enable RLS on cf_cuts / cutting_board_joined / training_examples.
--    These are populated by an out-of-band native tool via service role.
--    Service role bypasses RLS; no authenticated user has any business here.
ALTER TABLE public.cf_cuts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cutting_board_joined ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_examples ENABLE ROW LEVEL SECURITY;
