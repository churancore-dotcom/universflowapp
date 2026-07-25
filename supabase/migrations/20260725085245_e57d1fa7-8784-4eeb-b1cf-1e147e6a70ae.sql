
-- 1) Harden increment_artist_song_play against payout fraud
CREATE OR REPLACE FUNCTION public.increment_artist_song_play(_song_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_artist uuid;
  v_already boolean;
BEGIN
  -- Require authenticated caller
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  -- Song must exist and be live
  SELECT artist_user_id INTO v_artist
    FROM public.artist_songs
   WHERE id = _song_id AND status = 'live'::public.artist_song_status;
  IF v_artist IS NULL THEN
    RETURN;
  END IF;

  -- Artists can't credit their own songs
  IF v_artist = v_uid THEN
    RETURN;
  END IF;

  -- Per-user throttle (max 30 stream credits/min)
  IF NOT public.check_and_increment_rate_limit(v_uid, 'increment_artist_song_play', 30) THEN
    RETURN;
  END IF;

  -- One verified credit per user per song per calendar day
  SELECT EXISTS (
    SELECT 1 FROM public.song_play_events
     WHERE user_id = v_uid
       AND song_id = _song_id
       AND action = 'stream'
       AND created_at >= date_trunc('day', now())
  ) INTO v_already;

  IF v_already THEN
    RETURN;
  END IF;

  -- Log the verified play event (deduped ledger used for auditing)
  INSERT INTO public.song_play_events (
    user_id, track_id, song_id, title, artist, source, action, score_weight
  )
  SELECT v_uid, s.id::text, s.id, s.title,
         COALESCE((SELECT stage_name FROM public.artist_profiles WHERE user_id = s.artist_user_id LIMIT 1), 'Artist'),
         'artist_upload', 'stream', 1
    FROM public.artist_songs s WHERE s.id = _song_id;

  UPDATE public.artist_songs
     SET play_count = play_count + 1
   WHERE id = _song_id AND status = 'live'::public.artist_song_status;
END $function$;

REVOKE ALL ON FUNCTION public.increment_artist_song_play(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.increment_artist_song_play(uuid) TO authenticated;

-- 2) Tighten support_chats tamper trigger: allow user to zero their own unread_for_user,
-- but keep status/unread_for_admin/last_message_at/user_id immutable to non-admins.
CREATE OR REPLACE FUNCTION public.prevent_support_chat_tamper()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE v_jwt_role text;
BEGIN
  BEGIN v_jwt_role := current_setting('request.jwt.claim.role', true);
  EXCEPTION WHEN OTHERS THEN v_jwt_role := NULL; END;

  IF v_jwt_role = 'service_role'
     OR current_user IN ('service_role','postgres','supabase_admin')
     OR public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;

  -- Non-admin end users may only mark their own unread counter as read (0);
  -- every other privileged column is frozen to its previous value.
  NEW.user_id          := OLD.user_id;
  NEW.status           := OLD.status;
  NEW.unread_for_admin := OLD.unread_for_admin;
  NEW.last_message_at  := OLD.last_message_at;
  NEW.created_at       := OLD.created_at;

  IF NEW.unread_for_user IS DISTINCT FROM OLD.unread_for_user
     AND COALESCE(NEW.unread_for_user, -1) <> 0 THEN
    NEW.unread_for_user := OLD.unread_for_user;
  END IF;

  RETURN NEW;
END $function$;
