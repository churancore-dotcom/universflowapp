
ALTER TABLE public.artist_profiles
  ADD COLUMN IF NOT EXISTS artist_pick_song_id uuid REFERENCES public.artist_songs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS artist_pick_message text,
  ADD COLUMN IF NOT EXISTS artist_pick_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS gallery_urls text[] DEFAULT ARRAY[]::text[];

-- Enforce Artist Pick belongs to the artist (safety net; UI already scopes)
CREATE OR REPLACE FUNCTION public.validate_artist_pick()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.artist_pick_song_id IS NULL THEN
    IF NEW.artist_pick_message IS NULL OR TG_OP = 'INSERT' THEN
      RETURN NEW;
    END IF;
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.artist_songs s
    WHERE s.id = NEW.artist_pick_song_id
      AND s.artist_user_id = NEW.user_id
      AND s.status = 'live'::public.artist_song_status
  ) THEN
    RAISE EXCEPTION 'Artist Pick must be one of your live songs';
  END IF;

  IF TG_OP = 'INSERT'
     OR NEW.artist_pick_song_id IS DISTINCT FROM OLD.artist_pick_song_id
     OR NEW.artist_pick_message IS DISTINCT FROM OLD.artist_pick_message THEN
    NEW.artist_pick_set_at := now();
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_validate_artist_pick ON public.artist_profiles;
CREATE TRIGGER trg_validate_artist_pick
BEFORE INSERT OR UPDATE OF artist_pick_song_id, artist_pick_message ON public.artist_profiles
FOR EACH ROW EXECUTE FUNCTION public.validate_artist_pick();

-- Cap gallery size to 12 items to prevent abuse
CREATE OR REPLACE FUNCTION public.cap_artist_gallery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.gallery_urls IS NOT NULL AND array_length(NEW.gallery_urls, 1) > 12 THEN
    RAISE EXCEPTION 'Gallery is limited to 12 photos';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cap_artist_gallery ON public.artist_profiles;
CREATE TRIGGER trg_cap_artist_gallery
BEFORE INSERT OR UPDATE OF gallery_urls ON public.artist_profiles
FOR EACH ROW EXECUTE FUNCTION public.cap_artist_gallery();
