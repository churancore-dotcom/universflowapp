-- 1) artist-audio admin read must use the canonical role table, not profiles.is_admin
DROP POLICY IF EXISTS "artist-audio owner or admin read" ON storage.objects;
CREATE POLICY "artist-audio owner or admin read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'artist-audio'
  AND (
    (storage.foldername(name))[1] = (auth.uid())::text
    OR public.has_role(auth.uid(), 'admin'::app_role)
  )
);

-- 2) Stop public reads of the premium-gated `music` bucket.
DROP POLICY IF EXISTS "Public can read music and covers" ON storage.objects;

-- Covers stay fully public (artwork only, no premium content).
CREATE POLICY "Public can read covers"
ON storage.objects FOR SELECT TO anon, authenticated
USING (bucket_id = 'covers');

-- App release artifacts (APK) remain publicly downloadable.
CREATE POLICY "Public can read app releases"
ON storage.objects FOR SELECT TO anon, authenticated
USING (bucket_id = 'music' AND (storage.foldername(name))[1] = 'releases');

-- Catalog audio: readable (via signed URLs) only by users entitled to the song,
-- mirroring the entitlement rules already enforced on public.songs.
CREATE POLICY "Entitled users can read music objects"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'music'
  AND (
    EXISTS (
      SELECT 1 FROM public.songs s
      WHERE s.audio_url LIKE '%/music/' || storage.objects.name
        AND s.is_visible = true
        AND (s.is_premium_only = false OR public.has_premium_subscription(auth.uid()))
    )
    OR ((storage.foldername(name))[1] = 'requests' AND (storage.foldername(name))[2] = (auth.uid())::text)
    OR public.has_role(auth.uid(), 'admin'::app_role)
  )
);