
-- ============ TYPES ============
DO $$ BEGIN
  CREATE TYPE public.artist_team_role AS ENUM ('owner','admin','editor','analyst','viewer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.artist_team_status AS ENUM ('active','pending','revoked','declined');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ artist_team_members ============
CREATE TABLE IF NOT EXISTS public.artist_team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_profile_id uuid NOT NULL REFERENCES public.artist_profiles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role public.artist_team_role NOT NULL DEFAULT 'viewer',
  status public.artist_team_status NOT NULL DEFAULT 'active',
  invited_by uuid,
  invited_at timestamptz,
  joined_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (artist_profile_id, user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.artist_team_members TO authenticated;
GRANT ALL ON public.artist_team_members TO service_role;
ALTER TABLE public.artist_team_members ENABLE ROW LEVEL SECURITY;

-- ============ artist_team_invites ============
CREATE TABLE IF NOT EXISTS public.artist_team_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_profile_id uuid NOT NULL REFERENCES public.artist_profiles(id) ON DELETE CASCADE,
  email text NOT NULL,
  role public.artist_team_role NOT NULL DEFAULT 'viewer',
  code text NOT NULL UNIQUE,
  invited_by uuid NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  status public.artist_team_status NOT NULL DEFAULT 'pending',
  accepted_by uuid,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.artist_team_invites TO authenticated;
GRANT ALL ON public.artist_team_invites TO service_role;
ALTER TABLE public.artist_team_invites ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS artist_team_invites_code_idx ON public.artist_team_invites(code);
CREATE INDEX IF NOT EXISTS artist_team_invites_email_idx ON public.artist_team_invites(lower(email));

-- ============ label_access_requests ============
CREATE TABLE IF NOT EXISTS public.label_access_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  label_name text NOT NULL,
  roster jsonb NOT NULL DEFAULT '[]'::jsonb,
  proof_url text,
  website text,
  contact_email text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  admin_note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.label_access_requests TO authenticated;
GRANT ALL ON public.label_access_requests TO service_role;
ALTER TABLE public.label_access_requests ENABLE ROW LEVEL SECURITY;

-- ============ has_artist_access helper ============
CREATE OR REPLACE FUNCTION public.has_artist_access(_user_id uuid, _artist_profile_id uuid, _min_role public.artist_team_role DEFAULT 'viewer')
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.artist_team_members m
    WHERE m.artist_profile_id = _artist_profile_id
      AND m.user_id = _user_id
      AND m.status = 'active'
      AND CASE _min_role
        WHEN 'viewer'  THEN m.role IN ('viewer','analyst','editor','admin','owner')
        WHEN 'analyst' THEN m.role IN ('analyst','editor','admin','owner')
        WHEN 'editor'  THEN m.role IN ('editor','admin','owner')
        WHEN 'admin'   THEN m.role IN ('admin','owner')
        WHEN 'owner'   THEN m.role = 'owner'
      END
  );
$$;

REVOKE ALL ON FUNCTION public.has_artist_access(uuid,uuid,public.artist_team_role) FROM public;
GRANT EXECUTE ON FUNCTION public.has_artist_access(uuid,uuid,public.artist_team_role) TO authenticated, service_role;

-- ============ RLS POLICIES ============

-- artist_team_members
DROP POLICY IF EXISTS "members: view own team" ON public.artist_team_members;
CREATE POLICY "members: view own team" ON public.artist_team_members
FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR public.has_artist_access(auth.uid(), artist_profile_id, 'viewer')
  OR public.has_role(auth.uid(), 'admin')
);

DROP POLICY IF EXISTS "members: no direct insert" ON public.artist_team_members;
CREATE POLICY "members: no direct insert" ON public.artist_team_members
FOR INSERT TO authenticated WITH CHECK (false);

DROP POLICY IF EXISTS "members: no direct update" ON public.artist_team_members;
CREATE POLICY "members: no direct update" ON public.artist_team_members
FOR UPDATE TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "members: no direct delete" ON public.artist_team_members;
CREATE POLICY "members: no direct delete" ON public.artist_team_members
FOR DELETE TO authenticated USING (false);

-- artist_team_invites
DROP POLICY IF EXISTS "invites: view team or invitee" ON public.artist_team_invites;
CREATE POLICY "invites: view team or invitee" ON public.artist_team_invites
FOR SELECT TO authenticated
USING (
  public.has_artist_access(auth.uid(), artist_profile_id, 'admin')
  OR lower(email) = lower(coalesce((auth.jwt() ->> 'email'), ''))
  OR public.has_role(auth.uid(), 'admin')
);

DROP POLICY IF EXISTS "invites: no direct writes" ON public.artist_team_invites;
CREATE POLICY "invites: no direct insert" ON public.artist_team_invites
FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY "invites: no direct update" ON public.artist_team_invites
FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY "invites: no direct delete" ON public.artist_team_invites
FOR DELETE TO authenticated USING (false);

-- label_access_requests
DROP POLICY IF EXISTS "label: view own" ON public.label_access_requests;
CREATE POLICY "label: view own" ON public.label_access_requests
FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "label: insert own pending" ON public.label_access_requests;
CREATE POLICY "label: insert own pending" ON public.label_access_requests
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() AND status = 'pending' AND reviewed_by IS NULL);

DROP POLICY IF EXISTS "label: no user updates" ON public.label_access_requests;
CREATE POLICY "label: no user updates" ON public.label_access_requests
FOR UPDATE TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "label: no user delete" ON public.label_access_requests;
CREATE POLICY "label: no user delete" ON public.label_access_requests
FOR DELETE TO authenticated USING (false);

-- ============ BACKFILL owners ============
INSERT INTO public.artist_team_members (artist_profile_id, user_id, role, status, joined_at)
SELECT ap.id, ap.user_id, 'owner'::public.artist_team_role, 'active'::public.artist_team_status, ap.created_at
FROM public.artist_profiles ap
WHERE ap.user_id IS NOT NULL
ON CONFLICT (artist_profile_id, user_id) DO UPDATE SET role = 'owner', status = 'active';

-- ============ Auto-add owner when profile created ============
CREATE OR REPLACE FUNCTION public.ensure_owner_membership()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.user_id IS NOT NULL THEN
    INSERT INTO public.artist_team_members (artist_profile_id, user_id, role, status)
    VALUES (NEW.id, NEW.user_id, 'owner', 'active')
    ON CONFLICT (artist_profile_id, user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_artist_profile_owner_membership ON public.artist_profiles;
CREATE TRIGGER trg_artist_profile_owner_membership
AFTER INSERT ON public.artist_profiles
FOR EACH ROW EXECUTE FUNCTION public.ensure_owner_membership();

-- ============ RPCs ============

-- Create invite
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

  v_code := encode(gen_random_bytes(9), 'hex');

  INSERT INTO public.artist_team_invites (artist_profile_id, email, role, code, invited_by)
  VALUES (_artist_profile_id, lower(_email), _role, v_code, v_uid)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'invite_id', v_id, 'code', v_code);
END $$;

REVOKE ALL ON FUNCTION public.create_artist_invite(uuid,text,public.artist_team_role) FROM public;
GRANT EXECUTE ON FUNCTION public.create_artist_invite(uuid,text,public.artist_team_role) TO authenticated;

-- Accept invite
CREATE OR REPLACE FUNCTION public.accept_artist_invite(_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text := lower(coalesce((auth.jwt() ->> 'email'),''));
  v_inv public.artist_team_invites;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error','unauthorized'); END IF;

  SELECT * INTO v_inv FROM public.artist_team_invites WHERE code = _code;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','invite_not_found'); END IF;
  IF v_inv.status <> 'pending' THEN RETURN jsonb_build_object('error','invite_'||v_inv.status); END IF;
  IF v_inv.expires_at < now() THEN
    UPDATE public.artist_team_invites SET status='revoked', updated_at=now() WHERE id=v_inv.id;
    RETURN jsonb_build_object('error','invite_expired');
  END IF;
  IF v_email <> lower(v_inv.email) THEN
    RETURN jsonb_build_object('error','email_mismatch','expected',v_inv.email);
  END IF;

  INSERT INTO public.artist_team_members (artist_profile_id, user_id, role, status, invited_by, invited_at, joined_at)
  VALUES (v_inv.artist_profile_id, v_uid, v_inv.role, 'active', v_inv.invited_by, v_inv.created_at, now())
  ON CONFLICT (artist_profile_id, user_id) DO UPDATE
    SET role = EXCLUDED.role, status = 'active', revoked_at = NULL, updated_at = now();

  UPDATE public.artist_team_invites
     SET status='active', accepted_by=v_uid, accepted_at=now(), updated_at=now()
   WHERE id=v_inv.id;

  RETURN jsonb_build_object('ok', true, 'artist_profile_id', v_inv.artist_profile_id, 'role', v_inv.role);
END $$;

REVOKE ALL ON FUNCTION public.accept_artist_invite(text) FROM public;
GRANT EXECUTE ON FUNCTION public.accept_artist_invite(text) TO authenticated;

-- Decline invite
CREATE OR REPLACE FUNCTION public.decline_artist_invite(_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_email text := lower(coalesce((auth.jwt() ->> 'email'),''));
  v_inv public.artist_team_invites;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('error','unauthorized'); END IF;
  SELECT * INTO v_inv FROM public.artist_team_invites WHERE code = _code;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','invite_not_found'); END IF;
  IF v_email <> lower(v_inv.email) THEN RETURN jsonb_build_object('error','forbidden'); END IF;
  UPDATE public.artist_team_invites SET status='declined', updated_at=now() WHERE id=v_inv.id;
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.decline_artist_invite(text) FROM public;
GRANT EXECUTE ON FUNCTION public.decline_artist_invite(text) TO authenticated;

-- Revoke member
CREATE OR REPLACE FUNCTION public.revoke_artist_member(_artist_profile_id uuid, _user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_target public.artist_team_members;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error','unauthorized'); END IF;
  IF NOT public.has_artist_access(v_uid, _artist_profile_id, 'admin') THEN
    RETURN jsonb_build_object('error','forbidden');
  END IF;
  SELECT * INTO v_target FROM public.artist_team_members
   WHERE artist_profile_id=_artist_profile_id AND user_id=_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','not_found'); END IF;
  IF v_target.role = 'owner' THEN RETURN jsonb_build_object('error','cannot_revoke_owner'); END IF;
  IF v_target.role = 'admin' AND NOT public.has_artist_access(v_uid, _artist_profile_id, 'owner') THEN
    RETURN jsonb_build_object('error','only_owner_can_revoke_admin');
  END IF;
  UPDATE public.artist_team_members
     SET status='revoked', revoked_at=now(), updated_at=now()
   WHERE id=v_target.id;
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.revoke_artist_member(uuid,uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.revoke_artist_member(uuid,uuid) TO authenticated;

-- Update member role
CREATE OR REPLACE FUNCTION public.update_artist_member_role(_artist_profile_id uuid, _user_id uuid, _role public.artist_team_role)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_target public.artist_team_members;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error','unauthorized'); END IF;
  IF _role = 'owner' THEN RETURN jsonb_build_object('error','use_transfer_ownership'); END IF;
  IF NOT public.has_artist_access(v_uid, _artist_profile_id, 'admin') THEN
    RETURN jsonb_build_object('error','forbidden');
  END IF;
  SELECT * INTO v_target FROM public.artist_team_members
   WHERE artist_profile_id=_artist_profile_id AND user_id=_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','not_found'); END IF;
  IF v_target.role = 'owner' THEN RETURN jsonb_build_object('error','cannot_change_owner'); END IF;
  IF v_target.role = 'admin' AND NOT public.has_artist_access(v_uid, _artist_profile_id, 'owner') THEN
    RETURN jsonb_build_object('error','only_owner_can_change_admin');
  END IF;
  UPDATE public.artist_team_members SET role=_role, updated_at=now() WHERE id=v_target.id;
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.update_artist_member_role(uuid,uuid,public.artist_team_role) FROM public;
GRANT EXECUTE ON FUNCTION public.update_artist_member_role(uuid,uuid,public.artist_team_role) TO authenticated;

-- Submit label access request
CREATE OR REPLACE FUNCTION public.submit_label_access_request(
  _label_name text, _roster jsonb, _proof_url text, _website text, _contact_email text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error','unauthorized'); END IF;
  IF _label_name IS NULL OR length(_label_name) < 2 THEN RETURN jsonb_build_object('error','invalid_label_name'); END IF;

  INSERT INTO public.label_access_requests (user_id, label_name, roster, proof_url, website, contact_email)
  VALUES (v_uid, _label_name, coalesce(_roster,'[]'::jsonb), _proof_url, _website, _contact_email)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;
REVOKE ALL ON FUNCTION public.submit_label_access_request(text,jsonb,text,text,text) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_label_access_request(text,jsonb,text,text,text) TO authenticated;

-- Admin review label
CREATE OR REPLACE FUNCTION public.admin_review_label_access(_id uuid, _decision text, _admin_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid,'admin') THEN
    RETURN jsonb_build_object('error','forbidden');
  END IF;
  IF _decision NOT IN ('approved','rejected') THEN RETURN jsonb_build_object('error','bad_decision'); END IF;
  UPDATE public.label_access_requests
     SET status=_decision, admin_note=_admin_note, reviewed_by=v_uid, reviewed_at=now(), updated_at=now()
   WHERE id=_id;
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.admin_review_label_access(uuid,text,text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_review_label_access(uuid,text,text) TO authenticated;

-- updated_at triggers
CREATE TRIGGER trg_atm_updated BEFORE UPDATE ON public.artist_team_members
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_ati_updated BEFORE UPDATE ON public.artist_team_invites
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_lar_updated BEFORE UPDATE ON public.label_access_requests
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
