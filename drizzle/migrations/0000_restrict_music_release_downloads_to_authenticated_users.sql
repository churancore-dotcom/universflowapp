DROP POLICY IF EXISTS "Public can read app releases" ON storage.objects;
CREATE POLICY "Signed in users can read app releases"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'music'
  AND (storage.foldername(name))[1] = 'releases'
  AND auth.uid() IS NOT NULL
);