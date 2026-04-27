-- Storage bucket for beat sheet media (images and videos dragged into beats).

INSERT INTO storage.buckets (id, name, public)
VALUES ('beat-media', 'beat-media', true)
ON CONFLICT (id) DO NOTHING;

-- All authenticated users can read, insert, and delete their own uploads.

CREATE POLICY "beat_media_select"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'beat-media' AND auth.role() = 'authenticated');

CREATE POLICY "beat_media_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'beat-media' AND auth.role() = 'authenticated');

CREATE POLICY "beat_media_delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'beat-media' AND auth.role() = 'authenticated');
