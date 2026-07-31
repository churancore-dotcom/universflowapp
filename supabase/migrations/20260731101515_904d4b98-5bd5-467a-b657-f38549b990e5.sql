
CREATE TABLE public.ad_campaigns (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  advertiser text,
  kind text NOT NULL DEFAULT 'premium',
  headline text NOT NULL DEFAULT 'Go Premium',
  subtext text,
  image_url text,
  cta_label text NOT NULL DEFAULT 'Get Premium',
  cta_url text NOT NULL DEFAULT '/premium',
  duration_seconds integer NOT NULL DEFAULT 8,
  songs_interval integer NOT NULL DEFAULT 3,
  skippable boolean NOT NULL DEFAULT true,
  skip_after_seconds integer NOT NULL DEFAULT 5,
  is_active boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 0,
  starts_at timestamptz,
  ends_at timestamptz,
  impression_count bigint NOT NULL DEFAULT 0,
  skip_count bigint NOT NULL DEFAULT 0,
  click_count bigint NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ad_campaigns_kind_check CHECK (kind IN ('premium','brand')),
  CONSTRAINT ad_campaigns_duration_check CHECK (duration_seconds BETWEEN 3 AND 60),
  CONSTRAINT ad_campaigns_interval_check CHECK (songs_interval BETWEEN 1 AND 50),
  CONSTRAINT ad_campaigns_skip_after_check CHECK (skip_after_seconds BETWEEN 0 AND 60)
);

GRANT SELECT ON public.ad_campaigns TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ad_campaigns TO authenticated;
GRANT ALL ON public.ad_campaigns TO service_role;

ALTER TABLE public.ad_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Active ads are viewable by everyone"
  ON public.ad_campaigns FOR SELECT
  USING (is_active = true);

CREATE POLICY "Admins can view all ads"
  ON public.ad_campaigns FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can create ads"
  ON public.ad_campaigns FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update ads"
  ON public.ad_campaigns FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete ads"
  ON public.ad_campaigns FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_ad_campaigns_updated_at
  BEFORE UPDATE ON public.ad_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.ad_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES public.ad_campaigns(id) ON DELETE CASCADE,
  user_id uuid,
  action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ad_events_action_check CHECK (action IN ('view','skip','click','complete'))
);

CREATE INDEX ad_events_campaign_idx ON public.ad_events (campaign_id, created_at DESC);

GRANT INSERT ON public.ad_events TO anon;
GRANT SELECT, INSERT ON public.ad_events TO authenticated;
GRANT ALL ON public.ad_events TO service_role;

ALTER TABLE public.ad_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can log their own ad events"
  ON public.ad_events FOR INSERT
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());

CREATE POLICY "Admins can read ad events"
  ON public.ad_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.record_ad_event(_campaign_id uuid, _action text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _action NOT IN ('view','skip','click','complete') THEN
    RAISE EXCEPTION 'invalid action';
  END IF;

  INSERT INTO public.ad_events (campaign_id, user_id, action)
  VALUES (_campaign_id, auth.uid(), _action);

  UPDATE public.ad_campaigns SET
    impression_count = impression_count + (CASE WHEN _action = 'view' THEN 1 ELSE 0 END),
    skip_count = skip_count + (CASE WHEN _action = 'skip' THEN 1 ELSE 0 END),
    click_count = click_count + (CASE WHEN _action = 'click' THEN 1 ELSE 0 END)
  WHERE id = _campaign_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_ad_event(uuid, text) TO anon, authenticated;

INSERT INTO public.ad_campaigns
  (name, advertiser, kind, headline, subtext, cta_label, cta_url, duration_seconds, songs_interval, skippable, skip_after_seconds, priority)
VALUES
  ('Univers Flow Premium', 'Univers Flow', 'premium',
   'Music without limits',
   'Go Premium for ad-free listening, offline downloads, lossless audio and Studio Sound EQ.',
   'Get Premium', '/premium', 8, 3, true, 5, 100);
