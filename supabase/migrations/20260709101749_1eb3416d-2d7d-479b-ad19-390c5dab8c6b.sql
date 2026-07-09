-- Drop the two INSERT policies that let end users push files into
-- requests/{user_id}/... inside the public 'music' and 'covers' buckets.
-- Those buckets serve every object via public URL, so anything left under
-- requests/ is downloadable by anyone with the path.
DROP POLICY IF EXISTS "Users can upload song request audio" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload song request covers" ON storage.objects;

-- Allow the owning user (and admins) to remove leftover request files via the
-- Storage API. Storage protects direct DELETE from storage.objects, so cleanup
-- happens through the API using this policy.
DROP POLICY IF EXISTS "Users can delete their own request uploads" ON storage.objects;
CREATE POLICY "Users can delete their own request uploads"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id IN ('music', 'covers')
  AND (storage.foldername(name))[1] = 'requests'
  AND (
    (storage.foldername(name))[2] = auth.uid()::text
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  )
);