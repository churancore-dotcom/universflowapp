
DELETE FROM public.artist_followers WHERE artist_user_id = follower_user_id;

ALTER TABLE public.artist_followers
  DROP CONSTRAINT IF EXISTS artist_followers_no_self;
ALTER TABLE public.artist_followers
  ADD CONSTRAINT artist_followers_no_self
  CHECK (artist_user_id <> follower_user_id);

CREATE OR REPLACE FUNCTION public.on_user_library_artist_like()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_artist uuid;
  v_title  text;
  v_last   timestamptz;
  v_fan    text;
  v_extra  int;
BEGIN
  IF NEW.song_id IS NULL OR NEW.song_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN NEW;
  END IF;

  SELECT artist_user_id, title INTO v_artist, v_title
    FROM public.artist_songs
    WHERE id = NEW.song_id::uuid AND status = 'live'::public.artist_song_status;
  IF v_artist IS NULL THEN RETURN NEW; END IF;
  IF v_artist = NEW.user_id THEN RETURN NEW; END IF;

  UPDATE public.artist_songs
     SET like_count = like_count + 1
   WHERE id = NEW.song_id::uuid;

  INSERT INTO public.artist_push_throttle(artist_user_id, event_kind, last_notified_at, count_since_last)
  VALUES (v_artist, 'new_like', 'epoch'::timestamptz, 1)
  ON CONFLICT (artist_user_id, event_kind) DO UPDATE
    SET count_since_last = public.artist_push_throttle.count_since_last + 1
  RETURNING last_notified_at INTO v_last;

  IF v_last > now() - interval '30 minutes' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(username, 'Someone') INTO v_fan
    FROM public.profiles WHERE user_id = NEW.user_id;

  SELECT count_since_last INTO v_extra
    FROM public.artist_push_throttle
    WHERE artist_user_id = v_artist AND event_kind = 'new_like';

  BEGIN
    PERFORM public.notify_system_push(
      ARRAY[v_artist]::uuid[],
      CASE WHEN v_extra > 1 THEN '❤️ ' || v_extra::text || ' new saves'
           ELSE '❤️ Someone saved your track' END,
      CASE WHEN v_extra > 1 THEN v_fan || ' and ' || (v_extra-1)::text || ' more saved your music'
           ELSE v_fan || ' added "' || COALESCE(v_title,'your song') || '" to their library' END,
      '/artist/studio'
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'like push failed: %', SQLERRM;
  END;

  UPDATE public.artist_push_throttle
    SET last_notified_at = now(), count_since_last = 0
    WHERE artist_user_id = v_artist AND event_kind = 'new_like';

  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.on_user_library_artist_unlike()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_artist uuid;
BEGIN
  IF OLD.song_id IS NULL OR OLD.song_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN OLD;
  END IF;

  SELECT artist_user_id INTO v_artist
    FROM public.artist_songs WHERE id = OLD.song_id::uuid;
  IF v_artist IS NULL OR v_artist = OLD.user_id THEN RETURN OLD; END IF;

  UPDATE public.artist_songs
     SET like_count = GREATEST(0, like_count - 1)
   WHERE id = OLD.song_id::uuid;

  RETURN OLD;
END $function$;

DROP TRIGGER IF EXISTS trg_user_library_artist_unlike ON public.user_library;
CREATE TRIGGER trg_user_library_artist_unlike
  AFTER DELETE ON public.user_library
  FOR EACH ROW EXECUTE FUNCTION public.on_user_library_artist_unlike();

UPDATE public.artist_songs AS s
   SET like_count = COALESCE(sub.c, 0)
  FROM (
    SELECT ul.song_id, COUNT(*) AS c
      FROM public.user_library ul
      JOIN public.artist_songs a2
        ON a2.id::text = ul.song_id
       AND a2.artist_user_id <> ul.user_id
     GROUP BY ul.song_id
  ) AS sub
 WHERE s.id::text = sub.song_id;

UPDATE public.artist_songs SET like_count = 0
 WHERE id::text NOT IN (SELECT song_id FROM public.user_library WHERE song_id IS NOT NULL);

CREATE OR REPLACE FUNCTION public.increment_artist_song_view(_song_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;

  SELECT artist_user_id INTO v_owner
    FROM public.artist_songs
   WHERE id = _song_id AND status = 'live'::public.artist_song_status;
  IF v_owner IS NULL OR v_owner = v_uid THEN RETURN; END IF;

  IF EXISTS (
    SELECT 1 FROM public.song_play_events
     WHERE user_id = v_uid
       AND song_id = _song_id
       AND action = 'view'
       AND created_at > (now() - interval '24 hours')
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.song_play_events(user_id, song_id, track_id, title, artist, source, action, score_weight)
  SELECT v_uid, _song_id, id::text, title, '', 'artist', 'view', 0
    FROM public.artist_songs WHERE id = _song_id;

  UPDATE public.artist_songs
     SET view_count = view_count + 1
   WHERE id = _song_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.increment_artist_song_view(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.increment_artist_song_view(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.increment_artist_song_download(_song_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;

  SELECT artist_user_id INTO v_owner
    FROM public.artist_songs
   WHERE id = _song_id AND status = 'live'::public.artist_song_status;
  IF v_owner IS NULL OR v_owner = v_uid THEN RETURN; END IF;

  IF EXISTS (
    SELECT 1 FROM public.song_play_events
     WHERE user_id = v_uid
       AND song_id = _song_id
       AND action = 'download'
       AND created_at > (now() - interval '24 hours')
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.song_play_events(user_id, song_id, track_id, title, artist, source, action, score_weight)
  SELECT v_uid, _song_id, id::text, title, '', 'artist', 'download', 0
    FROM public.artist_songs WHERE id = _song_id;

  UPDATE public.artist_songs
     SET download_count = download_count + 1
   WHERE id = _song_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.increment_artist_song_download(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.increment_artist_song_download(uuid) TO authenticated;
