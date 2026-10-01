CREATE OR REPLACE FUNCTION public.cache_stream_songs(_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r jsonb;
  n integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN RETURN 0; END IF;
  IF jsonb_typeof(_rows) <> 'array' THEN RETURN 0; END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(_rows) LIMIT 50 LOOP
    IF char_length(coalesce(r->>'track_id','')) NOT BETWEEN 3 AND 220
       OR char_length(coalesce(r->>'title','')) NOT BETWEEN 1 AND 300
       OR char_length(coalesce(r->>'artist','')) NOT BETWEEN 1 AND 300 THEN
      CONTINUE;
    END IF;
    INSERT INTO public.stream_songs (track_id, source, title, artist, album, cover_url, duration, artist_image_url, metadata, last_seen_at)
    VALUES (
      r->>'track_id',
      CASE WHEN r->>'source' IN ('indexed','audius','jiosaavn','youtube') THEN r->>'source' ELSE 'indexed' END,
      left(r->>'title', 300), left(r->>'artist', 300), left(r->>'album', 300),
      CASE WHEN r->>'cover_url' ~* '^https://' THEN left(r->>'cover_url', 1000) END,
      CASE WHEN (r->>'duration') ~ '^\d{1,6}$' THEN (r->>'duration')::integer END,
      CASE WHEN r->>'artist_image_url' ~* '^https://' THEN left(r->>'artist_image_url', 1000) END,
      '{}'::jsonb, now()
    )
    -- Existing rows: only refresh freshness and fill gaps; never overwrite
    -- shared metadata other users rely on.
    ON CONFLICT (track_id) DO UPDATE SET
      last_seen_at = now(),
      cover_url = coalesce(stream_songs.cover_url, EXCLUDED.cover_url),
      duration = coalesce(stream_songs.duration, EXCLUDED.duration),
      artist_image_url = coalesce(stream_songs.artist_image_url, EXCLUDED.artist_image_url),
      album = coalesce(stream_songs.album, EXCLUDED.album);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.cache_stream_songs(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cache_stream_songs(jsonb) TO authenticated;