CREATE OR REPLACE FUNCTION public.decline_artist_invite(_code text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_inv public.artist_team_invites;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error','unauthorized'); END IF;
  SELECT lower(coalesce(p.email,'')) INTO v_email
    FROM public.profiles p WHERE p.user_id = v_uid AND p.email_verified = true;
  IF v_email IS NULL OR v_email = '' THEN RETURN jsonb_build_object('error','email_not_verified'); END IF;
  SELECT * INTO v_inv FROM public.artist_team_invites WHERE code = _code FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','invite_not_found'); END IF;
  IF v_inv.status <> 'pending' THEN RETURN jsonb_build_object('error','invite_'||v_inv.status); END IF;
  IF v_email <> lower(v_inv.email) THEN RETURN jsonb_build_object('error','forbidden'); END IF;
  UPDATE public.artist_team_invites SET status='declined', updated_at=now() WHERE id=v_inv.id;
  RETURN jsonb_build_object('ok', true);
END $function$;

DROP POLICY IF EXISTS "invites: view team or invitee" ON public.artist_team_invites;
CREATE POLICY "invites: view team or invitee" ON public.artist_team_invites
FOR SELECT TO authenticated USING (
  has_artist_access(auth.uid(), artist_profile_id, 'admin'::artist_team_role)
  OR has_role(auth.uid(), 'admin'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid() AND p.email_verified = true
      AND lower(coalesce(p.email,'')) = lower(artist_team_invites.email)
  )
);

REVOKE EXECUTE ON FUNCTION public.check_and_increment_rate_limit(uuid,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_increment_rate_limit(uuid,text,integer) TO service_role;