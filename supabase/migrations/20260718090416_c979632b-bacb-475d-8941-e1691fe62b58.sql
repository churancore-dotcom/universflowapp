
-- 1) friends: remove permissive duplicate INSERT policy, keep the strict one.
DROP POLICY IF EXISTS "Users can send friend requests" ON public.friends;

-- Attach the existing status-guard triggers (functions already exist).
DROP TRIGGER IF EXISTS trg_friends_enforce_pending_on_insert ON public.friends;
CREATE TRIGGER trg_friends_enforce_pending_on_insert
BEFORE INSERT ON public.friends
FOR EACH ROW EXECUTE FUNCTION public.enforce_friends_pending_on_insert();

DROP TRIGGER IF EXISTS trg_friends_prevent_recipient_column_change ON public.friends;
CREATE TRIGGER trg_friends_prevent_recipient_column_change
BEFORE UPDATE ON public.friends
FOR EACH ROW EXECUTE FUNCTION public.prevent_friends_recipient_column_change();

-- 2) playlists: attach owner/featured lock trigger.
DROP TRIGGER IF EXISTS trg_playlists_prevent_privileged_change ON public.playlists;
CREATE TRIGGER trg_playlists_prevent_privileged_change
BEFORE UPDATE ON public.playlists
FOR EACH ROW EXECUTE FUNCTION public.prevent_playlist_privileged_change();

-- 3) song_dedications: attach recipient-column lock trigger and add explicit WITH CHECK.
DROP TRIGGER IF EXISTS trg_song_dedications_prevent_recipient_column_change ON public.song_dedications;
CREATE TRIGGER trg_song_dedications_prevent_recipient_column_change
BEFORE UPDATE ON public.song_dedications
FOR EACH ROW EXECUTE FUNCTION public.prevent_song_dedication_recipient_column_change();

DROP POLICY IF EXISTS "Recipients can mark dedications as read" ON public.song_dedications;
CREATE POLICY "Recipients can mark dedications as read"
ON public.song_dedications
FOR UPDATE
TO authenticated
USING (auth.uid() = recipient_id)
WITH CHECK (auth.uid() = recipient_id);
