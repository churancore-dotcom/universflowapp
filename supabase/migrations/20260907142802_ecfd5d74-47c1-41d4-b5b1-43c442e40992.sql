DO $$
DECLARE
  r record;
  public_anon text[] := ARRAY[
    'app_trending_tracks',
    'get_viral_song_events',
    'get_artist_follower_count',
    'search_unclaimed_artist_profiles'
  ];
BEGIN
  FOR r IN
    SELECT p.oid,
           p.proname,
           pg_get_function_identity_arguments(p.oid) AS args,
           pg_get_function_result(p.oid) AS res
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    IF r.res = 'trigger' THEN
      -- Trigger functions are invoked by the engine; no role needs EXECUTE.
      EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM anon, authenticated', r.proname, r.args);
    ELSIF NOT (r.proname = ANY(public_anon)) THEN
      -- Everything else stays callable by signed-in users only.
      EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM anon', r.proname, r.args);
    END IF;
  END LOOP;
END $$;