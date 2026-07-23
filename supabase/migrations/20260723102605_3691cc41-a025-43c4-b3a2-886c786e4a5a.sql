
-- =========================================================
-- Artist analytics RPCs (Pass 1: Spotify-grade dashboard)
-- =========================================================

CREATE OR REPLACE FUNCTION public.get_artist_analytics(
  _artist_user_id uuid,
  _since timestamptz,
  _until timestamptz DEFAULT now(),
  _bucket text DEFAULT 'day'  -- 'hour' | 'day' | 'week' | 'month'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_song_ids uuid[];
  v_song_id_texts text[];
  v_totals jsonb;
  v_series jsonb;
  v_top_cities jsonb;
  v_top_countries jsonb;
  v_top_songs jsonb;
  v_followers_gained int;
  v_trunc text;
BEGIN
  -- Authorization: caller must be the artist themselves or an admin.
  IF NOT (auth.uid() = _artist_user_id OR public.has_role(auth.uid(), 'admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  -- Normalize bucket
  v_trunc := CASE lower(_bucket)
    WHEN 'hour'  THEN 'hour'
    WHEN 'week'  THEN 'week'
    WHEN 'month' THEN 'month'
    ELSE 'day'
  END;

  -- Song IDs owned by this artist (any status — so drafts still show up for the artist)
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[])
    INTO v_song_ids
    FROM public.artist_songs
    WHERE artist_user_id = _artist_user_id;

  SELECT COALESCE(array_agg(id::text), ARRAY[]::text[])
    INTO v_song_id_texts
    FROM unnest(v_song_ids) AS id;

  -- Totals across the window
  WITH ev AS (
    SELECT * FROM public.song_play_events
    WHERE created_at >= _since AND created_at < _until
      AND song_id = ANY(v_song_ids)
  )
  SELECT jsonb_build_object(
    'streams',   COUNT(*) FILTER (WHERE action = 'stream'),
    'saves',     COUNT(*) FILTER (WHERE action = 'save') +
                 COALESCE((
                   SELECT COUNT(*) FROM public.user_library ul
                   WHERE ul.added_at >= _since AND ul.added_at < _until
                     AND ul.song_id = ANY(v_song_id_texts)
                 ), 0),
    'shares',    COUNT(*) FILTER (WHERE action = 'share'),
    'skips',     COUNT(*) FILTER (WHERE action = 'skip'),
    'listeners', COUNT(DISTINCT COALESCE(user_id::text, session_id, 'anon'))
  ) INTO v_totals FROM ev;

  -- Followers gained in this window
  SELECT COUNT(*) INTO v_followers_gained
    FROM public.artist_followers
    WHERE artist_user_id = _artist_user_id
      AND created_at >= _since AND created_at < _until;

  v_totals := v_totals || jsonb_build_object('followers_gained', v_followers_gained);

  -- Time-series (streams + listeners per bucket)
  WITH bucketed AS (
    SELECT
      date_trunc(v_trunc, created_at) AS t,
      COUNT(*) FILTER (WHERE action = 'stream') AS streams,
      COUNT(DISTINCT COALESCE(user_id::text, session_id, 'anon')) AS listeners,
      COUNT(*) FILTER (WHERE action = 'save') AS saves
    FROM public.song_play_events
    WHERE created_at >= _since AND created_at < _until
      AND song_id = ANY(v_song_ids)
    GROUP BY 1
    ORDER BY 1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    't', to_char(t AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'streams', streams,
    'listeners', listeners,
    'saves', saves
  )), '[]'::jsonb) INTO v_series FROM bucketed;

  -- Top cities
  WITH tc AS (
    SELECT country_code, country_name, city, COUNT(*) AS c
    FROM public.song_play_events
    WHERE created_at >= _since AND created_at < _until
      AND song_id = ANY(v_song_ids)
      AND action = 'stream'
      AND city IS NOT NULL AND length(city) > 0
    GROUP BY 1,2,3 ORDER BY c DESC LIMIT 15
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'city', city, 'country_code', country_code, 'country_name', country_name, 'count', c
  )), '[]'::jsonb) INTO v_top_cities FROM tc;

  -- Top countries
  WITH tk AS (
    SELECT country_code, country_name, COUNT(*) AS c
    FROM public.song_play_events
    WHERE created_at >= _since AND created_at < _until
      AND song_id = ANY(v_song_ids)
      AND action = 'stream'
    GROUP BY 1,2 ORDER BY c DESC LIMIT 15
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'country_code', country_code, 'country_name', country_name, 'count', c
  )), '[]'::jsonb) INTO v_top_countries FROM tk;

  -- Top songs (by streams in the window)
  WITH ts AS (
    SELECT
      s.id, s.title, s.cover_url,
      COUNT(e.*) FILTER (WHERE e.action = 'stream') AS streams,
      COUNT(e.*) FILTER (WHERE e.action = 'save')   AS saves,
      COUNT(DISTINCT COALESCE(e.user_id::text, e.session_id, 'anon')) AS listeners
    FROM public.artist_songs s
    LEFT JOIN public.song_play_events e
      ON e.song_id = s.id
      AND e.created_at >= _since AND e.created_at < _until
    WHERE s.artist_user_id = _artist_user_id
    GROUP BY s.id, s.title, s.cover_url
    ORDER BY streams DESC NULLS LAST
    LIMIT 25
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'title', title, 'cover_url', cover_url,
    'streams', streams, 'saves', saves, 'listeners', listeners
  )), '[]'::jsonb) INTO v_top_songs FROM ts;

  RETURN jsonb_build_object(
    'totals', v_totals,
    'series', v_series,
    'top_cities', v_top_cities,
    'top_countries', v_top_countries,
    'top_songs', v_top_songs
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_artist_analytics(uuid, timestamptz, timestamptz, text) TO authenticated;


CREATE OR REPLACE FUNCTION public.get_song_analytics(
  _song_id uuid,
  _since timestamptz,
  _until timestamptz DEFAULT now(),
  _bucket text DEFAULT 'day'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_totals jsonb;
  v_series jsonb;
  v_top_cities jsonb;
  v_top_countries jsonb;
  v_trunc text;
BEGIN
  SELECT artist_user_id INTO v_owner FROM public.artist_songs WHERE id = _song_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Song not found' USING ERRCODE = '02000';
  END IF;
  IF NOT (auth.uid() = v_owner OR public.has_role(auth.uid(), 'admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  v_trunc := CASE lower(_bucket)
    WHEN 'hour'  THEN 'hour'
    WHEN 'week'  THEN 'week'
    WHEN 'month' THEN 'month'
    ELSE 'day'
  END;

  WITH ev AS (
    SELECT * FROM public.song_play_events
    WHERE created_at >= _since AND created_at < _until AND song_id = _song_id
  )
  SELECT jsonb_build_object(
    'streams',   COUNT(*) FILTER (WHERE action = 'stream'),
    'saves',     COUNT(*) FILTER (WHERE action = 'save') +
                 COALESCE((
                   SELECT COUNT(*) FROM public.user_library ul
                   WHERE ul.added_at >= _since AND ul.added_at < _until
                     AND ul.song_id = _song_id::text
                 ), 0),
    'shares',    COUNT(*) FILTER (WHERE action = 'share'),
    'skips',     COUNT(*) FILTER (WHERE action = 'skip'),
    'listeners', COUNT(DISTINCT COALESCE(user_id::text, session_id, 'anon'))
  ) INTO v_totals FROM ev;

  WITH bucketed AS (
    SELECT
      date_trunc(v_trunc, created_at) AS t,
      COUNT(*) FILTER (WHERE action = 'stream') AS streams,
      COUNT(DISTINCT COALESCE(user_id::text, session_id, 'anon')) AS listeners
    FROM public.song_play_events
    WHERE created_at >= _since AND created_at < _until AND song_id = _song_id
    GROUP BY 1 ORDER BY 1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    't', to_char(t AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'streams', streams, 'listeners', listeners
  )), '[]'::jsonb) INTO v_series FROM bucketed;

  WITH tc AS (
    SELECT country_code, country_name, city, COUNT(*) AS c
    FROM public.song_play_events
    WHERE created_at >= _since AND created_at < _until AND song_id = _song_id
      AND action = 'stream' AND city IS NOT NULL AND length(city) > 0
    GROUP BY 1,2,3 ORDER BY c DESC LIMIT 15
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'city', city, 'country_code', country_code, 'country_name', country_name, 'count', c
  )), '[]'::jsonb) INTO v_top_cities FROM tc;

  WITH tk AS (
    SELECT country_code, country_name, COUNT(*) AS c
    FROM public.song_play_events
    WHERE created_at >= _since AND created_at < _until AND song_id = _song_id
      AND action = 'stream'
    GROUP BY 1,2 ORDER BY c DESC LIMIT 15
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'country_code', country_code, 'country_name', country_name, 'count', c
  )), '[]'::jsonb) INTO v_top_countries FROM tk;

  RETURN jsonb_build_object(
    'song_id', _song_id,
    'totals', v_totals,
    'series', v_series,
    'top_cities', v_top_cities,
    'top_countries', v_top_countries
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_song_analytics(uuid, timestamptz, timestamptz, text) TO authenticated;

-- Helpful covering index for the artist-analytics scans over song_play_events
CREATE INDEX IF NOT EXISTS idx_song_play_events_song_created
  ON public.song_play_events (song_id, created_at DESC)
  WHERE song_id IS NOT NULL;
