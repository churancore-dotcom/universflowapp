CREATE OR REPLACE FUNCTION public.create_artist_invite(
  _artist_profile_id uuid,
  _email text,
  _role public.artist_team_role
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_code text;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error','unauthorized'); END IF;
  IF _role = 'owner' THEN RETURN jsonb_build_object('error','cannot_invite_owner'); END IF;
  IF NOT public.has_artist_access(v_uid, _artist_profile_id, 'admin') THEN
    RETURN jsonb_build_object('error','forbidden');
  END IF;
  IF _email IS NULL OR _email !~ '^[^@]+@[^@]+\.[^@]+$' THEN
    RETURN jsonb_build_object('error','invalid_email');
  END IF;

  -- pgcrypto is not enabled in this project; derive an 18-hex-char token
  -- from two random UUIDs instead of gen_random_bytes().
  v_code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 9)
         || substr(replace(gen_random_uuid()::text, '-', ''), 1, 9);

  INSERT INTO public.artist_team_invites (artist_profile_id, email, role, code, invited_by)
  VALUES (_artist_profile_id, lower(_email), _role, v_code, v_uid)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'invite_id', v_id, 'code', v_code);
END $$;

REVOKE ALL ON FUNCTION public.create_artist_invite(uuid,text,public.artist_team_role) FROM public;
GRANT EXECUTE ON FUNCTION public.create_artist_invite(uuid,text,public.artist_team_role) TO authenticated;