-- Walkthrough guides: a Resources guide that is backed by a real review row so
-- staff can leave timestamped notes on it with the Review player. The review
-- is flagged kind='guide' and hidden from the Reviews page; the guide row
-- points at it via review_id (null = the original plain YouTube embed).

ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'review';

ALTER TABLE public.reviews DROP CONSTRAINT IF EXISTS reviews_kind_check;
ALTER TABLE public.reviews
  ADD CONSTRAINT reviews_kind_check CHECK (kind IN ('review', 'guide'));

ALTER TABLE public.resource_guides
  ADD COLUMN IF NOT EXISTS review_id uuid REFERENCES public.reviews(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS resource_guides_review_id_key
  ON public.resource_guides (review_id) WHERE review_id IS NOT NULL;

-- Deleting a walkthrough guide takes its review (versions, comments, replies,
-- details) with it. AFTER DELETE so the FK cascade in the other direction
-- (review deleted elsewhere → guide row gone) is a harmless no-op here.
CREATE OR REPLACE FUNCTION public.resource_guides_delete_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.review_id IS NOT NULL THEN
    DELETE FROM public.reviews WHERE id = OLD.review_id AND kind = 'guide';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS resource_guides_delete_review_trg ON public.resource_guides;
CREATE TRIGGER resource_guides_delete_review_trg
  AFTER DELETE ON public.resource_guides
  FOR EACH ROW EXECUTE FUNCTION public.resource_guides_delete_review();
