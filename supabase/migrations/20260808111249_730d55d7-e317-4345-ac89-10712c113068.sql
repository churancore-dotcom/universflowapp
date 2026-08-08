CREATE INDEX IF NOT EXISTS song_play_events_recent_idx
  ON public.song_play_events (created_at DESC, country_code);

CREATE OR REPLACE FUNCTION public.app_trending_tracks(
  p_country text DEFAULT NULL,
  p_hours integer DEFAULT 48,
  p_limit integer DEFAULT 40
)
RETURNS TABLE (
  track_id text,
  title text,
  artist text,
  cover_url text,
  listeners bigint,
  plays bigint,
  score numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH win AS (
    SELECT
      e.track_id,
      e.title,
      e.artist,
      e.cover_url,
      e.user_id,
      e.session_id,
      e.action,
      e.score_weight,
      e.created_at
    FROM public.song_play_events e
    WHERE e.created_at > now() - (LEAST(GREATEST(COALESCE(p_hours, 48), 1), 720) || ' hours')::interval
      AND e.track_id IS NOT NULL
      AND (p_country IS NULL OR e.country_code = upper(p_country))
  ), agg AS (
    SELECT
      w.track_id,
      (array_agg(w.title ORDER BY w.created_at DESC))[1] AS title,
      (array_agg(w.artist ORDER BY w.created_at DESC))[1] AS artist,
      (array_agg(w.cover_url ORDER BY w.created_at DESC) FILTER (WHERE w.cover_url IS NOT NULL))[1] AS cover_url,
      COUNT(DISTINCT COALESCE(w.user_id::text, w.session_id, w.track_id)) AS listeners,
      COUNT(*) FILTER (WHERE w.action IN ('stream', 'play')) AS plays,
      COUNT(*) FILTER (WHERE w.action = 'skip') AS skips,
      COUNT(*) FILTER (WHERE w.action IN ('like', 'download')) AS loves,
      -- Recency: a play in the last few hours matters far more than one at the
      -- edge of the window, so the shelf actually moves during the day.
      SUM(
        GREATEST(w.score_weight, 0)
        * exp(-EXTRACT(EPOCH FROM (now() - w.created_at)) / 86400.0)
      ) AS weighted
    FROM win w
    GROUP BY w.track_id
  )
  SELECT
    a.track_id,
    a.title,
    a.artist,
    a.cover_url,
    a.listeners,
    a.plays,
    -- Unique listeners dominate; raw replays are damped by sqrt so one heavy
    -- looper cannot push a track to #1.
    ROUND(
      (a.listeners * 3.0)
      + sqrt(GREATEST(a.plays, 0)::numeric) * 1.5
      + (a.loves * 2.0)
      + a.weighted
      - (a.skips * 1.75)
    , 4) AS score
  FROM agg a
  WHERE a.title IS NOT NULL
    AND a.artist IS NOT NULL
    AND a.listeners >= 1
  ORDER BY score DESC, a.listeners DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 40), 1), 100);
$$;

REVOKE ALL ON FUNCTION public.app_trending_tracks(text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_trending_tracks(text, integer, integer) TO anon, authenticated, service_role;