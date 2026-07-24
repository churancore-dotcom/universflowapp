-- Add release scheduling columns
ALTER TABLE public.artist_songs
  ADD COLUMN IF NOT EXISTS scheduled_release_at timestamptz,
  ADD COLUMN IF NOT EXISTS release_date date,
  ADD COLUMN IF NOT EXISTS genre text,
  ADD COLUMN IF NOT EXISTS description text;

CREATE INDEX IF NOT EXISTS idx_artist_songs_scheduled_release_at
  ON public.artist_songs (scheduled_release_at)
  WHERE status = 'scheduled';

-- Auto-publish trigger: on any read/update touching scheduled songs whose time has arrived,
-- flip them to live. We do this via a lightweight function callable by cron OR on-demand.
CREATE OR REPLACE FUNCTION public.publish_due_scheduled_songs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count integer;
BEGIN
  UPDATE public.artist_songs
     SET status = 'live',
         updated_at = now()
   WHERE status = 'scheduled'
     AND scheduled_release_at IS NOT NULL
     AND scheduled_release_at <= now();
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_due_scheduled_songs() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_due_scheduled_songs() TO authenticated, service_role;

-- BEFORE INSERT trigger: if scheduled_release_at is set and in the future, force status='scheduled'.
-- If scheduled_release_at is set and in the past/now, force status='live'.
CREATE OR REPLACE FUNCTION public.enforce_artist_song_release_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.scheduled_release_at IS NOT NULL THEN
    IF NEW.scheduled_release_at > now() THEN
      NEW.status := 'scheduled';
    ELSE
      NEW.status := 'live';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_artist_song_release_state ON public.artist_songs;
CREATE TRIGGER trg_enforce_artist_song_release_state
  BEFORE INSERT OR UPDATE OF scheduled_release_at, status ON public.artist_songs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_artist_song_release_state();