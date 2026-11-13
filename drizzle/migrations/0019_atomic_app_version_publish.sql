CREATE OR REPLACE FUNCTION public.publish_app_version(
  _version_code integer,
  _version_name text,
  _apk_url text,
  _release_notes text,
  _is_mandatory boolean,
  _min_supported_version_code integer
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _new_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only admins can publish app updates' USING ERRCODE = '42501';
  END IF;
  IF _version_code IS NULL OR _version_code < 1 THEN
    RAISE EXCEPTION 'Version code must be a positive number';
  END IF;
  IF coalesce(trim(_version_name), '') = '' OR coalesce(trim(_apk_url), '') = '' THEN
    RAISE EXCEPTION 'Version name and APK URL are required';
  END IF;

  -- Insert first, then switch the old release off, all in one transaction:
  -- if anything fails, the previous release stays live.
  INSERT INTO public.app_versions (version_code, version_name, apk_url, release_notes, is_mandatory, is_active, min_supported_version_code)
  VALUES (_version_code, trim(_version_name), trim(_apk_url), nullif(trim(coalesce(_release_notes, '')), ''), coalesce(_is_mandatory, false), true, greatest(coalesce(_min_supported_version_code, 0), 0))
  RETURNING id INTO _new_id;

  UPDATE public.app_versions SET is_active = false WHERE is_active = true AND id <> _new_id;
  RETURN _new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.activate_app_version(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only admins can change the active release' USING ERRCODE = '42501';
  END IF;
  UPDATE public.app_versions SET is_active = true WHERE id = _id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Release not found';
  END IF;
  UPDATE public.app_versions SET is_active = false WHERE is_active = true AND id <> _id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.publish_app_version(integer, text, text, text, boolean, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.activate_app_version(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_app_version(integer, text, text, text, boolean, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.activate_app_version(uuid) TO authenticated;