-- Comment moderation on agency threads: admin-tier users can delete any
-- message and edit their own (edited_at marks edited messages in the UI).
ALTER TABLE public.agency_comments
  ADD COLUMN IF NOT EXISTS edited_at timestamptz;

-- Was: own comments only.
ALTER POLICY "Delete own agency comments" ON public.agency_comments
  USING (author_id = auth.uid() OR public.is_admin(auth.uid()));

CREATE POLICY "Admins edit own agency comments" ON public.agency_comments
  FOR UPDATE TO authenticated
  USING (author_id = auth.uid() AND public.is_admin(auth.uid()))
  WITH CHECK (author_id = auth.uid() AND public.is_admin(auth.uid()));
