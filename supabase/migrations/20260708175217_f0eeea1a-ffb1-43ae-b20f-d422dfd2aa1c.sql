
-- 1. Drop obsolete RPCs across all overloaded signatures
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('reapply_artist_application', 'submit_artist_application')
  LOOP
    EXECUTE 'DROP FUNCTION ' || r.sig::text || ' CASCADE';
  END LOOP;
END $$;

-- 2. Drop the safe view (it references id_doc_type enum column)
DROP VIEW IF EXISTS public.artist_applications_safe;

-- 3. Rewrite trigger functions that reference id_doc_* columns
CREATE OR REPLACE FUNCTION public.purge_artist_kyc_files_on_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_url   text;
  v_token text;
  v_paths text[] := ARRAY[]::text[];
BEGIN
  IF NEW.status NOT IN ('approved','rejected') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF OLD.selfie_path IS NOT NULL THEN v_paths := v_paths || OLD.selfie_path; END IF;

  IF array_length(v_paths, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT public.safe_jsonb_text(value) INTO v_url
      FROM public.app_settings WHERE key = 'edge_purge_artist_kyc_url';
    SELECT btrim(value, '"') INTO v_token
      FROM public.internal_secrets WHERE key = 'kyc_purge_token';

    IF v_url IS NULL OR v_token IS NULL OR v_url !~ '^https?://' THEN
      RETURN NEW;
    END IF;

    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object(
        'system_token', v_token,
        'paths', to_jsonb(v_paths),
        'application_id', NEW.id
      ),
      timeout_milliseconds := 20000
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'purge_artist_kyc_files_on_review failed without blocking review: %', SQLERRM;
  END;

  RETURN NEW;
END
$fn$;

CREATE OR REPLACE FUNCTION public.on_artist_application_reviewed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_slug text;
  v_base text;
  v_i int := 0;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;

  IF NEW.status = 'approved' THEN
    INSERT INTO public.user_roles(user_id, role)
    VALUES (NEW.user_id, 'artist'::public.app_role)
    ON CONFLICT DO NOTHING;

    v_base := regexp_replace(lower(coalesce(NEW.stage_name, 'artist')), '[^a-z0-9]+', '-', 'g');
    v_base := trim(both '-' from v_base);
    IF v_base = '' THEN v_base := 'artist'; END IF;
    v_slug := v_base;
    WHILE EXISTS (SELECT 1 FROM public.artist_profiles WHERE slug = v_slug) LOOP
      v_i := v_i + 1;
      v_slug := v_base || '-' || v_i::text;
    END LOOP;

    INSERT INTO public.artist_profiles(
      user_id, stage_name, slug, avatar_url, country_code, social_links, is_verified
    ) VALUES (
      NEW.user_id, NEW.stage_name, v_slug, NEW.artist_photo_path,
      NEW.country_code, NEW.social_links, true
    )
    ON CONFLICT (user_id) DO UPDATE
      SET stage_name = EXCLUDED.stage_name,
          is_verified = true,
          updated_at = now();

    NEW.selfie_path := NULL;
    NEW.reviewed_at := COALESCE(NEW.reviewed_at, now());

  ELSIF NEW.status = 'rejected' THEN
    NEW.selfie_path := NULL;
    NEW.reviewed_at := COALESCE(NEW.reviewed_at, now());
  END IF;

  RETURN NEW;
END
$fn$;

-- 4. Drop obsolete columns from artist_applications
ALTER TABLE public.artist_applications
  DROP COLUMN IF EXISTS id_doc_type,
  DROP COLUMN IF EXISTS id_doc_front_path,
  DROP COLUMN IF EXISTS id_doc_back_path,
  DROP COLUMN IF EXISTS id_image_hash,
  DROP COLUMN IF EXISTS ocr_extracted_name,
  DROP COLUMN IF EXISTS name_match_score;

-- 5. Add new verification signal columns
ALTER TABLE public.artist_applications
  ADD COLUMN IF NOT EXISTS platform_photo_url text,
  ADD COLUMN IF NOT EXISTS face_match_platform_score real,
  ADD COLUMN IF NOT EXISTS face_match_platform_status text,
  ADD COLUMN IF NOT EXISTS social_verified_url text,
  ADD COLUMN IF NOT EXISTS social_verified_status text,
  ADD COLUMN IF NOT EXISTS ownership_check_at timestamptz;

-- 6. Anti-abuse: 1 application per user, ever
CREATE OR REPLACE FUNCTION public.enforce_artist_application_anti_abuse()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_any_id uuid;
  v_dup_user uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT id INTO v_any_id
    FROM public.artist_applications
    WHERE user_id = NEW.user_id
    LIMIT 1;

    IF v_any_id IS NOT NULL THEN
      RAISE EXCEPTION 'You already have an artist application on this account. Only one verification is allowed per account.'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  IF NEW.phone_hash IS NOT NULL THEN
    SELECT user_id INTO v_dup_user
    FROM public.artist_applications
    WHERE phone_hash = NEW.phone_hash
      AND user_id <> NEW.user_id
    LIMIT 1;

    IF v_dup_user IS NOT NULL THEN
      RAISE EXCEPTION 'This phone number is already linked to another artist account on Universflow.'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  RETURN NEW;
END
$fn$;

-- 7. Unique music platform URL across all applications (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS idx_artist_apps_platform_url_unique
  ON public.artist_applications (lower(music_platform_url))
  WHERE music_platform_url IS NOT NULL;

-- 8. Recreate submit_artist_application (adds ownership_code + social_verified_url; blocks any prior app)
CREATE OR REPLACE FUNCTION public.submit_artist_application(
  p_stage_name text,
  p_real_name text,
  p_phone text,
  p_country_code text,
  p_social_links jsonb,
  p_music_platform_url text,
  p_selfie_path text,
  p_artist_photo_path text,
  p_phone_hash text,
  p_ownership_code text DEFAULT NULL,
  p_social_verified_url text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_app_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Login required.' USING ERRCODE = '28000';
  END IF;

  IF EXISTS (SELECT 1 FROM public.artist_applications WHERE user_id = v_uid) THEN
    RAISE EXCEPTION 'You already have an artist application on this account. Only one verification is allowed per account.'
      USING ERRCODE = '23505';
  END IF;

  IF p_phone_hash IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.artist_applications
    WHERE phone_hash = NULLIF(BTRIM(p_phone_hash), '')
      AND status IN ('pending','approved')
  ) THEN
    RAISE EXCEPTION 'This phone number is already linked to another artist account on Universflow.'
      USING ERRCODE = '23505';
  END IF;

  UPDATE public.profiles SET account_type = 'artist' WHERE user_id = v_uid;

  INSERT INTO public.artist_applications(
    user_id, stage_name, real_name, phone, country_code, social_links,
    selfie_path, artist_photo_path, phone_hash, music_platform_url,
    ownership_code, social_verified_url, status
  ) VALUES (
    v_uid,
    NULLIF(BTRIM(p_stage_name), ''),
    NULLIF(BTRIM(p_real_name), ''),
    NULLIF(BTRIM(p_phone), ''),
    upper(left(NULLIF(BTRIM(p_country_code), ''), 2)),
    COALESCE(p_social_links, '{}'::jsonb),
    NULLIF(BTRIM(p_selfie_path), ''),
    NULLIF(BTRIM(p_artist_photo_path), ''),
    NULLIF(BTRIM(p_phone_hash), ''),
    NULLIF(BTRIM(p_music_platform_url), ''),
    NULLIF(BTRIM(p_ownership_code), ''),
    NULLIF(BTRIM(p_social_verified_url), ''),
    'pending'::public.artist_app_status
  ) RETURNING id INTO v_app_id;

  RETURN jsonb_build_object('success', true, 'application_id', v_app_id);
END
$fn$;

REVOKE ALL ON FUNCTION public.submit_artist_application(
  text, text, text, text, jsonb, text, text, text, text, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_artist_application(
  text, text, text, text, jsonb, text, text, text, text, text, text
) TO authenticated, service_role;

-- 9. Recreate safe view without ID-doc fields; add new signals
CREATE VIEW public.artist_applications_safe
WITH (security_invoker = true) AS
SELECT
  id, user_id, stage_name, real_name, phone, country_code, social_links,
  music_platform_url, ownership_code, ownership_verified_at, ownership_check_at,
  platform_photo_url,
  face_match_platform_status, face_match_platform_score,
  social_verified_url, social_verified_status,
  face_match_status, face_match_score,
  auto_check_warnings, auto_checks_at,
  selfie_path, artist_photo_path,
  status, reviewed_at, reviewed_by, created_at, updated_at
FROM public.artist_applications
WHERE auth.uid() = user_id
   OR public.has_role(auth.uid(), 'admin'::public.app_role);

GRANT SELECT ON public.artist_applications_safe TO authenticated;

-- 10. Drop obsolete enum type (safe now that column is gone)
DROP TYPE IF EXISTS public.id_doc_type;
