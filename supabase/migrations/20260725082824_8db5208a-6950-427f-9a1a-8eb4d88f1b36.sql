
DROP POLICY IF EXISTS "artist-audio public read" ON storage.objects;
CREATE POLICY "artist-audio public read"
ON storage.objects FOR SELECT
USING (bucket_id = 'artist-audio');

DROP POLICY IF EXISTS "artist-audio owner insert" ON storage.objects;
CREATE POLICY "artist-audio owner insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'artist-audio'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "artist-audio owner update" ON storage.objects;
CREATE POLICY "artist-audio owner update"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'artist-audio'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'artist-audio'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "artist-audio owner delete" ON storage.objects;
CREATE POLICY "artist-audio owner delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'artist-audio'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
