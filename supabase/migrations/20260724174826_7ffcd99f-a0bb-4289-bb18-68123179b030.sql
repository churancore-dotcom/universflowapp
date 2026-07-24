
CREATE TABLE IF NOT EXISTS public.artist_claim_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_profile_id uuid NOT NULL REFERENCES public.artist_profiles(id) ON DELETE CASCADE,
  stage_name text NOT NULL,
  proof_music_url text,
  proof_social_url text,
  proof_note text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  admin_note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, target_profile_id)
);

GRANT SELECT, INSERT ON public.artist_claim_requests TO authenticated;
GRANT ALL ON public.artist_claim_requests TO service_role;

ALTER TABLE public.artist_claim_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "claim_requests_own_read" ON public.artist_claim_requests
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "claim_requests_own_insert" ON public.artist_claim_requests
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND status = 'pending');

CREATE POLICY "claim_requests_admin_update" ON public.artist_claim_requests
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TRIGGER trg_claim_requests_updated
  BEFORE UPDATE ON public.artist_claim_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RPC: user submits a claim
CREATE OR REPLACE FUNCTION public.submit_artist_claim(
  _target_profile_id uuid,
  _proof_music_url text,
  _proof_social_url text,
  _proof_note text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_stage text;
  v_owner uuid;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Login required' USING ERRCODE='28000'; END IF;

  SELECT stage_name, user_id INTO v_stage, v_owner
    FROM public.artist_profiles WHERE id = _target_profile_id;
  IF v_stage IS NULL THEN RAISE EXCEPTION 'Profile not found'; END IF;

  IF v_owner = v_uid THEN
    RAISE EXCEPTION 'You already own this profile' USING ERRCODE='23505';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.artist_applications WHERE user_id = v_uid AND status='approved'
  ) THEN
    RAISE EXCEPTION 'You already have an approved artist profile on this account' USING ERRCODE='23505';
  END IF;

  INSERT INTO public.artist_claim_requests(
    user_id, target_profile_id, stage_name,
    proof_music_url, proof_social_url, proof_note, status
  ) VALUES (
    v_uid, _target_profile_id, v_stage,
    NULLIF(BTRIM(_proof_music_url),''),
    NULLIF(BTRIM(_proof_social_url),''),
    NULLIF(BTRIM(_proof_note),''),
    'pending'
  )
  ON CONFLICT (user_id, target_profile_id) DO UPDATE
    SET proof_music_url = EXCLUDED.proof_music_url,
        proof_social_url = EXCLUDED.proof_social_url,
        proof_note = EXCLUDED.proof_note,
        status = 'pending',
        updated_at = now()
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'claim_id', v_id);
END $$;

-- RPC: admin approves/rejects
CREATE OR REPLACE FUNCTION public.admin_review_artist_claim(
  _claim_id uuid, _decision text, _admin_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.artist_claim_requests%ROWTYPE;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE='42501';
  END IF;
  IF _decision NOT IN ('approved','rejected') THEN
    RAISE EXCEPTION 'Invalid decision';
  END IF;

  UPDATE public.artist_claim_requests
    SET status = _decision,
        admin_note = COALESCE(_admin_note, admin_note),
        reviewed_by = auth.uid(),
        reviewed_at = now(),
        updated_at = now()
    WHERE id = _claim_id AND status = 'pending'
    RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Claim not found or already reviewed'; END IF;

  IF _decision = 'approved' THEN
    -- Transfer profile ownership
    UPDATE public.artist_profiles
      SET user_id = v_row.user_id, is_verified = true, updated_at = now()
      WHERE id = v_row.target_profile_id;

    -- Grant artist role
    INSERT INTO public.user_roles(user_id, role)
      VALUES (v_row.user_id, 'artist'::public.app_role)
      ON CONFLICT DO NOTHING;

    UPDATE public.profiles SET account_type='artist' WHERE user_id = v_row.user_id;

    BEGIN
      PERFORM public.notify_system_push(
        ARRAY[v_row.user_id]::uuid[],
        '✓ Profile claim approved',
        'You now own "' || v_row.stage_name || '" on Universflow.',
        '/artist/studio'
      );
    EXCEPTION WHEN OTHERS THEN NULL; END;
  ELSE
    BEGIN
      PERFORM public.notify_system_push(
        ARRAY[v_row.user_id]::uuid[],
        'Claim update',
        'Your claim for "' || v_row.stage_name || '" needs another look.',
        '/artist/onboarding'
      );
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  PERFORM public.admin_log_event('artist_claim_' || _decision, 'info',
    jsonb_build_object('claim_id', _claim_id, 'user_id', v_row.user_id, 'profile_id', v_row.target_profile_id));

  RETURN jsonb_build_object('success', true, 'status', _decision);
END $$;

-- Search unclaimed profiles helper (public read of existing artist_profiles is fine)
CREATE OR REPLACE FUNCTION public.search_unclaimed_artist_profiles(_query text, _limit int DEFAULT 20)
RETURNS TABLE(id uuid, stage_name text, slug text, avatar_url text, is_claimed boolean, total_plays bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ap.id, ap.stage_name, ap.slug, ap.avatar_url,
         (ap.user_id IS NOT NULL) AS is_claimed,
         ap.total_plays
  FROM public.artist_profiles ap
  WHERE (_query IS NULL OR _query = '' OR ap.stage_name ILIKE '%' || _query || '%')
  ORDER BY ap.total_plays DESC NULLS LAST, ap.stage_name ASC
  LIMIT LEAST(GREATEST(_limit, 1), 50);
$$;

GRANT EXECUTE ON FUNCTION public.submit_artist_claim(uuid,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_review_artist_claim(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_unclaimed_artist_profiles(text,int) TO authenticated, anon;
