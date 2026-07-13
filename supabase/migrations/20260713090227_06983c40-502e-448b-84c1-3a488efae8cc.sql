CREATE INDEX IF NOT EXISTS idx_stream_songs_last_seen_at ON public.stream_songs (last_seen_at DESC) WHERE cover_url IS NOT NULL AND audio_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stream_songs_artist_last_seen ON public.stream_songs (artist, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_stream_songs_artist_title_last_seen ON public.stream_songs (artist, title, last_seen_at DESC);
DROP INDEX IF EXISTS public.idx_stream_songs_artist_title;