CREATE INDEX IF NOT EXISTS ad_events_user_campaign_action_idx
  ON public.ad_events (user_id, campaign_id, action, created_at DESC);

CREATE OR REPLACE FUNCTION public.record_ad_event(_campaign_id uuid, _action text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF _action NOT IN ('view','skip','click','complete') THEN
    RAISE EXCEPTION 'invalid action';
  END IF;

  -- Only campaigns currently being served can be counted.
  IF NOT EXISTS (
    SELECT 1 FROM public.ad_campaigns c
    WHERE c.id = _campaign_id AND c.is_active
      AND (c.starts_at IS NULL OR c.starts_at <= now())
      AND (c.ends_at IS NULL OR c.ends_at > now())
  ) THEN
    RETURN;
  END IF;

  -- One counted event per listener, campaign and action per 30 seconds,
  -- so a single account cannot inflate or spam the statistics.
  IF EXISTS (
    SELECT 1 FROM public.ad_events e
    WHERE e.user_id = _uid AND e.campaign_id = _campaign_id AND e.action = _action
      AND e.created_at > now() - interval '30 seconds'
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.ad_events (campaign_id, user_id, action)
  VALUES (_campaign_id, _uid, _action);

  UPDATE public.ad_campaigns SET
    impression_count = impression_count + (CASE WHEN _action = 'view' THEN 1 ELSE 0 END),
    skip_count = skip_count + (CASE WHEN _action = 'skip' THEN 1 ELSE 0 END),
    click_count = click_count + (CASE WHEN _action = 'click' THEN 1 ELSE 0 END)
  WHERE id = _campaign_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_ad_event(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_ad_event(uuid, text) TO authenticated;