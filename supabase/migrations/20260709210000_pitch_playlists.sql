-- Pitch Video Search: personal playlists for the new Playlist view.
-- Each playlist belongs to one user (RLS owner-only). Items snapshot the
-- full pitch row as jsonb so a playlist keeps playing even if the Triton
-- search index changes; row_key (game_pk-at_bat-pitch) dedupes.

CREATE TABLE public.pitch_playlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.pitch_playlist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id uuid NOT NULL REFERENCES public.pitch_playlists(id) ON DELETE CASCADE,
  row_key text NOT NULL,
  clip jsonb NOT NULL,
  position integer NOT NULL DEFAULT 0,
  added_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (playlist_id, row_key)
);

CREATE INDEX pitch_playlist_items_playlist_idx
  ON public.pitch_playlist_items (playlist_id, position);

ALTER TABLE public.pitch_playlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pitch_playlist_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner manages own playlists" ON public.pitch_playlists
  FOR ALL TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Owner manages own playlist items" ON public.pitch_playlist_items
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pitch_playlists p WHERE p.id = playlist_id AND p.created_by = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.pitch_playlists p WHERE p.id = playlist_id AND p.created_by = auth.uid()));
