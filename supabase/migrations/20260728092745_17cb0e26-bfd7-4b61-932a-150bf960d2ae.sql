-- Replace the public SELECT policy on artist-audio with an authenticated-only policy.
DROP POLICY IF EXISTS "artist-audio public read" ON storage.objects;
DROP POLICY IF EXISTS "artist-audio authenticated read" ON storage.objects;

CREATE POLICY "artist-audio authenticated read"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'artist-audio');