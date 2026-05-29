-- Allow 'draft' status for proposals in progress (being filled out via the form).
ALTER TABLE public.ad_read_proposals
  DROP CONSTRAINT IF EXISTS ad_read_proposals_status_check;

ALTER TABLE public.ad_read_proposals
  ADD CONSTRAINT ad_read_proposals_status_check
    CHECK (status IN ('draft', 'pending', 'accepted', 'declined', 'archived'));
