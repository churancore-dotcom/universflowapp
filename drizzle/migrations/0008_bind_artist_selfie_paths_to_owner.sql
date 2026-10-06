CREATE OR REPLACE FUNCTION public.enforce_artist_selfie_path_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NEW.selfie_path IS NOT NULL AND (
    NEW.selfie_path !~ ('^' || NEW.user_id::text || '/[^/]+$')
    OR NEW.selfie_path LIKE '%..%'
    OR length(NEW.selfie_path) > 500
  ) THEN
    RAISE EXCEPTION 'Invalid identity photo path.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END
$fn$;

REVOKE ALL ON FUNCTION public.enforce_artist_selfie_path_owner() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_artist_selfie_path_owner() TO service_role;

DROP TRIGGER IF EXISTS enforce_artist_selfie_path_owner_trigger ON public.artist_applications;
CREATE TRIGGER enforce_artist_selfie_path_owner_trigger
BEFORE INSERT OR UPDATE OF selfie_path, user_id ON public.artist_applications
FOR EACH ROW EXECUTE FUNCTION public.enforce_artist_selfie_path_owner();