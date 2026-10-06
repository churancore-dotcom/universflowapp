ALTER TABLE public.ad_campaigns
  ADD COLUMN IF NOT EXISTS video_url text;

COMMENT ON COLUMN public.ad_campaigns.video_url IS 'Optional public video creative URL; image_url remains the poster and fallback.';