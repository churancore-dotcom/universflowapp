DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('increment_artist_song_play','increment_artist_song_view')
      AND pg_get_function_result(p.oid) <> 'trigger'
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO anon, authenticated', r.proname, r.args);
  END LOOP;
END $$;