CREATE TABLE public.feed_not_interested (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 220),
  artist text NOT NULL CHECK (char_length(artist) BETWEEN 1 AND 220),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, title, artist)
);
GRANT SELECT, INSERT, DELETE ON public.feed_not_interested TO authenticated;
GRANT ALL ON public.feed_not_interested TO service_role;
ALTER TABLE public.feed_not_interested ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own not-interested read" ON public.feed_not_interested FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Own not-interested insert" ON public.feed_not_interested FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own not-interested delete" ON public.feed_not_interested FOR DELETE TO authenticated USING (auth.uid() = user_id);