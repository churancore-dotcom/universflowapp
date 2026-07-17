
-- Tighten friends INSERT: only allow pending/blocked at row-write time.
DROP POLICY IF EXISTS "Users can create friend requests" ON public.friends;
DROP POLICY IF EXISTS "Users can insert their friendships" ON public.friends;
DROP POLICY IF EXISTS "Users can create their friendships" ON public.friends;
CREATE POLICY "Users can create friend requests"
  ON public.friends FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND status IN ('pending','blocked')
  );

-- Tighten playlists UPDATE: add WITH CHECK mirroring USING so users cannot
-- reassign ownership or self-promote to featured.
DROP POLICY IF EXISTS "Users can update their own playlists" ON public.playlists;
CREATE POLICY "Users can update their own playlists"
  ON public.playlists FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Trigger: prevent non-admin users from flipping is_featured or reassigning user_id.
CREATE OR REPLACE FUNCTION public.prevent_playlist_privileged_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_jwt_role text;
BEGIN
  BEGIN v_jwt_role := current_setting('request.jwt.claim.role', true);
  EXCEPTION WHEN OTHERS THEN v_jwt_role := NULL; END;

  IF v_jwt_role = 'service_role'
     OR current_user IN ('service_role','postgres','supabase_admin')
     OR public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;

  NEW.user_id := OLD.user_id;
  IF to_jsonb(NEW) ? 'is_featured' THEN
    NEW.is_featured := OLD.is_featured;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_playlist_privileged_change ON public.playlists;
CREATE TRIGGER trg_prevent_playlist_privileged_change
  BEFORE UPDATE ON public.playlists
  FOR EACH ROW EXECUTE FUNCTION public.prevent_playlist_privileged_change();
