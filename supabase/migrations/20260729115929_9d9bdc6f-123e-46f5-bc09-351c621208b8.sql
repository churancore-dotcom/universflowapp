
-- 1) Fix artist-audio bucket unscoped SELECT
DROP POLICY IF EXISTS "artist-audio authenticated read" ON storage.objects;
DROP POLICY IF EXISTS "artist-audio public read" ON storage.objects;

CREATE POLICY "artist-audio owner or admin read"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'artist-audio'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE user_id = auth.uid() AND is_admin = true
    )
  )
);

-- 2) Ban enforcement: helper + trigger to revoke sessions on ban/suspend
CREATE OR REPLACE FUNCTION public.is_active_user(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT status IS NULL OR status NOT IN ('banned', 'suspended')
     FROM public.profiles WHERE user_id = _user_id),
    true
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_active_user(uuid) TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.revoke_sessions_on_ban()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NEW.status IN ('banned', 'suspended')
     AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    DELETE FROM auth.refresh_tokens WHERE user_id = NEW.user_id::text;
    DELETE FROM auth.sessions WHERE user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_revoke_sessions_on_ban ON public.profiles;
CREATE TRIGGER trg_revoke_sessions_on_ban
AFTER UPDATE OF status ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.revoke_sessions_on_ban();
