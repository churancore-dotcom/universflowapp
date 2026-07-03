-- =====================================================================
-- Artist verification redesign: remove government ID docs, add music
-- platform URL, purge all previously collected ID data.
-- =====================================================================

-- 1) New column: music_platform_url on applications and profiles
ALTER TABLE public.artist_applications
  ADD COLUMN IF NOT EXISTS music_platform_url text;

ALTER TABLE public.artist_profiles
  ADD COLUMN IF NOT EXISTS music_platform_url text;

-- 2) Relax id_doc_type NOT NULL so new applications don't need it
ALTER TABLE public.artist_applications
  ALTER COLUMN id_doc_type DROP NOT NULL;

-- 3) Legal-compliance purge: wipe all stored ID document data & hashes
UPDATE public.artist_applications
SET id_doc_front_path = NULL,
    id_doc_back_path  = NULL,
    id_image_hash     = NULL,
    ocr_extracted_name = NULL,
    name_match_score  = NULL,
    id_doc_type       = NULL
WHERE id_doc_front_path IS NOT NULL
   OR id_doc_back_path  IS NOT NULL
   OR id_image_hash     IS NOT NULL;

-- 4) Recreate submit_artist_application with new signature (no ID docs)
DROP FUNCTION IF EXISTS public.submit_artist_application(
  text, text, text, text, jsonb, public.id_doc_type, text, text, text, text, text, text
);

CREATE OR REPLACE FUNCTION public.submit_artist_application(
  p_stage_name text,
  p_real_name text,
  p_phone text,
  p_country_code text,
  p_social_links jsonb,
  p_music_platform_url text,
  p_selfie_path text,
  p_artist_photo_path text,
  p_phone_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_application_id uuid;
  v_existing public.artist_applications%ROWTYPE;
  v_next_allowed timestamptz;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Login required.' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_existing
  FROM public.artist_applications
  WHERE user_id = v_user_id
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.status = 'rejected'::public.artist_app_status THEN
      v_next_allowed := COALESCE(v_existing.reviewed_at, v_existing.updated_at, v_existing.created_at) + interval '7 days';
      IF now() < v_next_allowed THEN
        RAISE EXCEPTION 'Your previous artist verification was rejected. You can re-submit after %.', to_char(v_next_allowed, 'YYYY-MM-DD HH24:MI UTC')
          USING ERRCODE = '22023';
      END IF;
      RAISE EXCEPTION 'Use the re-submit verification button from your artist status screen.'
        USING ERRCODE = '22023';
    END IF;
    RAISE EXCEPTION 'You already have an artist application. Open the artist status screen for live updates.'
      USING ERRCODE = '23505';
  END IF;

  IF p_phone_hash IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.artist_applications other
    WHERE other.phone_hash = NULLIF(BTRIM(p_phone_hash), '')
      AND other.status IN ('pending','approved')
  ) THEN
    RAISE EXCEPTION 'This phone number is already linked to another artist account on Universflow.'
      USING ERRCODE = '23505';
  END IF;

  UPDATE public.profiles
  SET account_type = 'artist'
  WHERE user_id = v_user_id;

  INSERT INTO public.artist_applications (
    user_id, stage_name, real_name, phone, country_code, social_links,
    selfie_path, artist_photo_path, phone_hash, music_platform_url, status
  ) VALUES (
    v_user_id,
    NULLIF(BTRIM(p_stage_name), ''),
    NULLIF(BTRIM(p_real_name), ''),
    NULLIF(BTRIM(p_phone), ''),
    upper(left(NULLIF(BTRIM(p_country_code), ''), 2)),
    COALESCE(p_social_links, '{}'::jsonb),
    NULLIF(BTRIM(p_selfie_path), ''),
    NULLIF(BTRIM(p_artist_photo_path), ''),
    NULLIF(BTRIM(p_phone_hash), ''),
    NULLIF(BTRIM(p_music_platform_url), ''),
    'pending'::public.artist_app_status
  )
  RETURNING id INTO v_application_id;

  RETURN jsonb_build_object('success', true, 'application_id', v_application_id);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.submit_artist_application(
  text, text, text, text, jsonb, text, text, text, text
) TO authenticated;

-- 5) Recreate reapply_artist_application with new signature
DROP FUNCTION IF EXISTS public.reapply_artist_application(
  uuid, jsonb, public.id_doc_type, text, text, text, text, text
);

CREATE OR REPLACE FUNCTION public.reapply_artist_application(
  p_application_id uuid,
  p_social_links jsonb,
  p_music_platform_url text,
  p_selfie_path text,
  p_artist_photo_path text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_app public.artist_applications%ROWTYPE;
  v_next_allowed timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Login required.' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_app
  FROM public.artist_applications
  WHERE id = p_application_id AND user_id = auth.uid()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Artist application not found.' USING ERRCODE = '02000';
  END IF;

  IF v_app.status <> 'rejected'::public.artist_app_status THEN
    RAISE EXCEPTION 'Only rejected applications can be re-submitted.' USING ERRCODE = '22023';
  END IF;

  v_next_allowed := COALESCE(v_app.reviewed_at, v_app.updated_at, v_app.created_at) + interval '7 days';
  IF now() < v_next_allowed THEN
    RAISE EXCEPTION 'You can re-submit verification after %.', to_char(v_next_allowed, 'YYYY-MM-DD HH24:MI UTC')
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles
  SET account_type = 'artist'
  WHERE user_id = auth.uid();

  UPDATE public.artist_applications
  SET
    social_links       = COALESCE(p_social_links, '{}'::jsonb),
    selfie_path        = NULLIF(BTRIM(p_selfie_path), ''),
    artist_photo_path  = NULLIF(BTRIM(p_artist_photo_path), ''),
    music_platform_url = NULLIF(BTRIM(p_music_platform_url), ''),
    id_doc_type        = NULL,
    id_doc_front_path  = NULL,
    id_doc_back_path   = NULL,
    id_image_hash      = NULL,
    status             = 'pending'::public.artist_app_status,
    admin_note         = NULL,
    reviewed_by        = NULL,
    reviewed_at        = NULL,
    face_match_score   = NULL,
    face_match_status  = NULL,
    ocr_extracted_name = NULL,
    name_match_score   = NULL,
    auto_check_warnings = NULL,
    auto_checks_at     = NULL,
    updated_at         = now()
  WHERE id = v_app.id;

  RETURN jsonb_build_object('success', true, 'application_id', v_app.id);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.reapply_artist_application(
  uuid, jsonb, text, text, text
) TO authenticated;

-- 6) Update anti-abuse trigger: no more ID image hash check
CREATE OR REPLACE FUNCTION public.enforce_artist_application_anti_abuse()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_last_rejected timestamptz;
  v_dup_user uuid;
BEGIN
  SELECT MAX(COALESCE(reviewed_at, updated_at)) INTO v_last_rejected
  FROM public.artist_applications
  WHERE user_id = NEW.user_id AND status = 'rejected';

  IF v_last_rejected IS NOT NULL AND v_last_rejected > now() - interval '7 days' THEN
    RAISE EXCEPTION 'You can re-apply 7 days after a rejection. Next attempt allowed after %.',
      to_char(v_last_rejected + interval '7 days', 'YYYY-MM-DD HH24:MI UTC')
      USING ERRCODE = '22023';
  END IF;

  IF NEW.phone_hash IS NOT NULL THEN
    SELECT user_id INTO v_dup_user
    FROM public.artist_applications
    WHERE phone_hash = NEW.phone_hash
      AND status IN ('pending','approved')
      AND user_id <> NEW.user_id
    LIMIT 1;
    IF v_dup_user IS NOT NULL THEN
      RAISE EXCEPTION 'This phone number is already linked to another artist account on Universflow.'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  RETURN NEW;
END
$function$;

-- 7) Enable realtime on song_play_events for artist analytics live refresh
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'song_play_events'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.song_play_events';
  END IF;
END $$;
