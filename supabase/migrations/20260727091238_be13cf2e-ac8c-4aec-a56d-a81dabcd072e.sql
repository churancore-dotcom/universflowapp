
-- 1) Validate music_platform_url server-side (SSRF hardening)
CREATE OR REPLACE FUNCTION public.validate_artist_application_url()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text := NULLIF(BTRIM(NEW.music_platform_url), '');
  v_host text;
  v_ok boolean := false;
BEGIN
  IF v_url IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_url !~* '^https?://' THEN
    RAISE EXCEPTION 'Music platform URL must be http(s)' USING ERRCODE = '22023';
  END IF;

  -- Extract host: strip scheme, userinfo, port, path.
  v_host := lower(regexp_replace(v_url, '^https?://', '', 'i'));
  v_host := split_part(v_host, '/', 1);
  v_host := split_part(v_host, '?', 1);
  v_host := split_part(v_host, '#', 1);
  v_host := split_part(v_host, '@', 2);
  IF v_host = '' THEN v_host := split_part(lower(regexp_replace(v_url, '^https?://', '', 'i')), '/', 1); END IF;
  v_host := split_part(v_host, ':', 1);

  IF v_host ~ '^(?:localhost|127\.|10\.|0\.|169\.254\.|192\.168\.|100\.(?:6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.|172\.(?:1[6-9]|2[0-9]|3[0-1])\.|::1|fc|fd|fe80:)' THEN
    RAISE EXCEPTION 'Music platform URL host is not allowed' USING ERRCODE = '22023';
  END IF;

  IF v_host ~ '(^|\.)(open\.spotify\.com|spotify\.com|music\.apple\.com|music\.youtube\.com|youtube\.com|youtu\.be|soundcloud\.com|deezer\.com|tidal\.com|jiosaavn\.com|saavn\.com|gaana\.com)$'
     OR v_host ~ '(^|\.)music\.amazon\.(com|in|co\.uk|de)$' THEN
    v_ok := true;
  END IF;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'Music platform URL host is not on the allowlist' USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_validate_artist_application_url ON public.artist_applications;
CREATE TRIGGER trg_validate_artist_application_url
BEFORE INSERT OR UPDATE OF music_platform_url ON public.artist_applications
FOR EACH ROW EXECUTE FUNCTION public.validate_artist_application_url();

-- 2) Sanitize social_links on artist_profiles: strip any value whose string
--    representation begins with an unsafe scheme (javascript:, data:, vbscript:, file:).
CREATE OR REPLACE FUNCTION public.sanitize_artist_social_links()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  k text;
  v text;
  cleaned jsonb := '{}'::jsonb;
BEGIN
  IF NEW.social_links IS NULL OR jsonb_typeof(NEW.social_links) <> 'object' THEN
    RETURN NEW;
  END IF;

  FOR k, v IN SELECT key, CASE WHEN jsonb_typeof(value) = 'string' THEN value #>> '{}' ELSE value::text END
              FROM jsonb_each(NEW.social_links)
  LOOP
    IF v IS NULL OR btrim(v) = '' THEN
      CONTINUE;
    END IF;
    -- Reject any value that even hints at a dangerous scheme, after
    -- normalizing whitespace and control chars an attacker could inject.
    IF regexp_replace(lower(btrim(v)), '[\s\u0000-\u001f]', '', 'g')
       ~ '^(javascript|data|vbscript|file|about|blob):' THEN
      CONTINUE;
    END IF;
    cleaned := cleaned || jsonb_build_object(k, to_jsonb(v));
  END LOOP;

  NEW.social_links := cleaned;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sanitize_artist_social_links ON public.artist_profiles;
CREATE TRIGGER trg_sanitize_artist_social_links
BEFORE INSERT OR UPDATE OF social_links ON public.artist_profiles
FOR EACH ROW EXECUTE FUNCTION public.sanitize_artist_social_links();

-- Also sanitize on artist_applications (source of profile social_links)
DROP TRIGGER IF EXISTS trg_sanitize_artist_app_social_links ON public.artist_applications;
CREATE TRIGGER trg_sanitize_artist_app_social_links
BEFORE INSERT OR UPDATE OF social_links ON public.artist_applications
FOR EACH ROW EXECUTE FUNCTION public.sanitize_artist_social_links();

-- Clean up any existing rows that already stored unsafe schemes.
UPDATE public.artist_profiles
SET social_links = (
  SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb)
  FROM jsonb_each(social_links)
  WHERE jsonb_typeof(value) <> 'string'
     OR regexp_replace(lower(btrim(value #>> '{}')), '[\s\u0000-\u001f]', '', 'g')
        !~ '^(javascript|data|vbscript|file|about|blob):'
)
WHERE social_links IS NOT NULL
  AND jsonb_typeof(social_links) = 'object'
  AND EXISTS (
    SELECT 1 FROM jsonb_each(social_links) e
    WHERE jsonb_typeof(e.value) = 'string'
      AND regexp_replace(lower(btrim(e.value #>> '{}')), '[\s\u0000-\u001f]', '', 'g')
          ~ '^(javascript|data|vbscript|file|about|blob):'
  );
