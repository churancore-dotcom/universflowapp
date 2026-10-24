CREATE OR REPLACE FUNCTION public.accept_artist_invite(_code text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_inv public.artist_team_invites;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error','unauthorized'); END IF;

  -- Use the server-side, app-verified email only (never the JWT claim).
  SELECT lower(coalesce(p.email,'')) INTO v_email
    FROM public.profiles p
   WHERE p.user_id = v_uid AND p.email_verified = true;
  IF v_email IS NULL OR v_email = '' THEN
    RETURN jsonb_build_object('error','email_not_verified');
  END IF;

  SELECT * INTO v_inv FROM public.artist_team_invites WHERE code = _code FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','invite_not_found'); END IF;
  IF v_inv.status <> 'pending' THEN RETURN jsonb_build_object('error','invite_'||v_inv.status); END IF;
  IF v_inv.expires_at < now() THEN
    UPDATE public.artist_team_invites SET status='revoked', updated_at=now() WHERE id=v_inv.id;
    RETURN jsonb_build_object('error','invite_expired');
  END IF;
  IF v_email <> lower(v_inv.email) THEN
    RETURN jsonb_build_object('error','email_mismatch');
  END IF;

  INSERT INTO public.artist_team_members (artist_profile_id, user_id, role, status, invited_by, invited_at, joined_at)
  VALUES (v_inv.artist_profile_id, v_uid, v_inv.role, 'active', v_inv.invited_by, v_inv.created_at, now())
  ON CONFLICT (artist_profile_id, user_id) DO UPDATE
    SET role = EXCLUDED.role, status = 'active', revoked_at = NULL, updated_at = now();

  UPDATE public.artist_team_invites
     SET status='active', accepted_by=v_uid, accepted_at=now(), updated_at=now()
   WHERE id=v_inv.id;

  RETURN jsonb_build_object('ok', true, 'artist_profile_id', v_inv.artist_profile_id, 'role', v_inv.role);
END $function$;