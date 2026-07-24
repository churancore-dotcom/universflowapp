
-- Fix friends INSERT: only allow status='pending'
DROP POLICY IF EXISTS "Users can create friend requests" ON public.friends;
CREATE POLICY "Users can create friend requests"
ON public.friends
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id AND status = 'pending');

-- Fix playlists UPDATE: prevent user_id reassignment and is_featured escalation via WITH CHECK
DROP POLICY IF EXISTS "Users can update their own playlists" ON public.playlists;
CREATE POLICY "Users can update their own playlists"
ON public.playlists
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (
  auth.uid() = user_id
  AND (is_featured = false OR is_featured IS NULL OR public.has_role(auth.uid(), 'admin'))
);

-- Trigger safety net: forbid user_id changes and is_featured escalation on UPDATE
CREATE OR REPLACE FUNCTION public.enforce_playlist_update_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Cannot change playlist ownership';
  END IF;
  IF NEW.is_featured IS DISTINCT FROM OLD.is_featured
     AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can change featured status';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_playlist_update_integrity ON public.playlists;
CREATE TRIGGER trg_enforce_playlist_update_integrity
BEFORE UPDATE ON public.playlists
FOR EACH ROW EXECUTE FUNCTION public.enforce_playlist_update_integrity();
