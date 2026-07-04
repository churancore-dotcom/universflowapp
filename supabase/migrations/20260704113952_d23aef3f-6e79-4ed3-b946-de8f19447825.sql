-- 1) Add music-platform ownership proof columns for artist verification.
ALTER TABLE public.artist_applications
  ADD COLUMN IF NOT EXISTS ownership_code text,
  ADD COLUMN IF NOT EXISTS ownership_verified_at timestamptz;

-- 2) Purge historical ID doc file paths from the applications table.
--    (Physical files were removed at review time by the existing
--    purge_artist_kyc_files_on_review trigger; anything still lingering is
--    orphaned; we just null the references so nothing surfaces client-side.)
UPDATE public.artist_applications
SET id_doc_type = NULL,
    id_doc_front_path = NULL,
    id_doc_back_path  = NULL,
    id_image_hash     = NULL
WHERE id_doc_type IS NOT NULL
   OR id_doc_front_path IS NOT NULL
   OR id_doc_back_path IS NOT NULL
   OR id_image_hash IS NOT NULL;

-- 3) Fire the purge edge function for anything left in the KYC bucket.
--    Wrapped in a DO block so a missing config never blocks the migration.
DO $$
DECLARE v_url text; v_token text; r record;
BEGIN
  SELECT public.safe_jsonb_text(value) INTO v_url
    FROM public.app_settings WHERE key = 'edge_purge_artist_kyc_url';
  SELECT btrim(value, '"') INTO v_token
    FROM public.internal_secrets WHERE key = 'kyc_purge_token';
  IF v_url IS NULL OR v_token IS NULL THEN RETURN; END IF;

  -- Backfill purge for any storage objects still parked under artist-kyc/.
  FOR r IN
    SELECT array_agg(name) AS paths
    FROM storage.objects
    WHERE bucket_id = 'artist-kyc'
      AND (name LIKE '%-front.jpg' OR name LIKE '%-back.jpg')
  LOOP
    IF r.paths IS NOT NULL AND array_length(r.paths, 1) > 0 THEN
      PERFORM net.http_post(
        url := v_url,
        headers := jsonb_build_object('Content-Type','application/json'),
        body := jsonb_build_object(
          'system_token', v_token,
          'paths', to_jsonb(r.paths),
          'application_id', gen_random_uuid()
        ),
        timeout_milliseconds := 20000
      );
    END IF;
  END LOOP;
END $$;
