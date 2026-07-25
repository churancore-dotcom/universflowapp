CREATE OR REPLACE FUNCTION public.enforce_artist_song_release_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
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
$function$;