-- Asset Search: personal playlists for the Assets (Shade drive) view.
-- Mirrors pitch_playlists: each playlist belongs to one user (RLS
-- owner-only). Items snapshot the Shade asset as jsonb so a playlist keeps
-- working even if the drive is reorganized; asset_key (Shade asset id)
-- dedupes.

CREATE TABLE public.asset_playlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.asset_playlist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id uuid NOT NULL REFERENCES public.asset_playlists(id) ON DELETE CASCADE,
  asset_key text NOT NULL,
  asset jsonb NOT NULL,
  position integer NOT NULL DEFAULT 0,
  added_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (playlist_id, asset_key)
);

CREATE INDEX asset_playlist_items_playlist_idx
  ON public.asset_playlist_items (playlist_id, position);

ALTER TABLE public.asset_playlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_playlist_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner manages own asset playlists" ON public.asset_playlists
  FOR ALL TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Owner manages own asset playlist items" ON public.asset_playlist_items
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.asset_playlists p WHERE p.id = playlist_id AND p.created_by = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.asset_playlists p WHERE p.id = playlist_id AND p.created_by = auth.uid()));
