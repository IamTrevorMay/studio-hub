-- Guides section at the top of the Resources page: admin-tier posts a titled
-- YouTube link, everyone who can see Resources can watch it.
CREATE TABLE IF NOT EXISTS public.resource_guides (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL CHECK (length(btrim(title)) > 0),
  youtube_url  text NOT NULL,
  -- Parsed once on write so the thumbnail and the embed don't have to re-parse
  -- the URL on every render, and so a malformed link fails at insert time.
  youtube_id   text NOT NULL CHECK (youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
  position     integer NOT NULL DEFAULT 0,
  created_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS resource_guides_order_idx
  ON public.resource_guides (position, created_at DESC);

ALTER TABLE public.resource_guides ENABLE ROW LEVEL SECURITY;

-- Read: everyone who can reach the Resources page. That page is not admin-only
-- and is absent from the locked contractor/client sidebars, so staff is exactly
-- the audience — is_staff() = admin/director/member.
DROP POLICY IF EXISTS "resource_guides select" ON public.resource_guides;
CREATE POLICY "resource_guides select" ON public.resource_guides
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

-- Write: admin-tier only. is_admin() = admin + director.
DROP POLICY IF EXISTS "resource_guides insert" ON public.resource_guides;
CREATE POLICY "resource_guides insert" ON public.resource_guides
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "resource_guides update" ON public.resource_guides;
CREATE POLICY "resource_guides update" ON public.resource_guides
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "resource_guides delete" ON public.resource_guides;
CREATE POLICY "resource_guides delete" ON public.resource_guides
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- created_by is stamped server-side rather than trusted from the client.
CREATE OR REPLACE FUNCTION public.resource_guides_stamp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
  ELSE
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS resource_guides_stamp_trg ON public.resource_guides;
CREATE TRIGGER resource_guides_stamp_trg
  BEFORE INSERT OR UPDATE ON public.resource_guides
  FOR EACH ROW EXECUTE FUNCTION public.resource_guides_stamp();
