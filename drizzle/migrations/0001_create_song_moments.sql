CREATE TABLE public.song_moments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  song_id text NOT NULL,
  song_title text NOT NULL,
  song_artist text NOT NULL DEFAULT '',
  cover_url text,
  audio_url text,
  source text,
  position_ms integer NOT NULL DEFAULT 0,
  clip_ms integer NOT NULL DEFAULT 30000,
  feeling text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.song_moments TO authenticated;
GRANT ALL ON public.song_moments TO service_role;

ALTER TABLE public.song_moments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own moments" ON public.song_moments
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own moments" ON public.song_moments
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own moments" ON public.song_moments
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own moments" ON public.song_moments
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX song_moments_user_created_idx ON public.song_moments (user_id, created_at DESC);
CREATE INDEX song_moments_user_song_idx ON public.song_moments (user_id, song_id);