CREATE TABLE public.play_purchase_claims (
  purchase_token text PRIMARY KEY,
  user_id uuid NOT NULL,
  product_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.play_purchase_claims TO service_role;
REVOKE ALL ON public.play_purchase_claims FROM anon, authenticated;
ALTER TABLE public.play_purchase_claims ENABLE ROW LEVEL SECURITY;

-- Preserve the most recent previously granted Play token across upgrades.
INSERT INTO public.play_purchase_claims (purchase_token, user_id, product_id, expires_at)
SELECT DISTINCT ON (purchase_token) purchase_token, user_id, 'legacy', expires_at
FROM public.user_subscriptions
WHERE platform = 'android' AND purchase_token IS NOT NULL AND expires_at IS NOT NULL
ORDER BY purchase_token, updated_at ASC;

CREATE OR REPLACE FUNCTION public.claim_verified_play_purchase(
  _user_id uuid, _purchase_token text, _product_id text, _order_id text, _consumed boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  claim public.play_purchase_claims%ROWTYPE;
  days integer;
  expiry timestamptz;
BEGIN
  days := CASE _product_id WHEN 'universflow_premium_1m' THEN 30 WHEN 'universflow_premium_2m' THEN 60 WHEN 'universflow_premium_3m' THEN 90 ELSE NULL END;
  IF days IS NULL OR _user_id IS NULL OR length(_purchase_token) < 20 THEN
    RAISE EXCEPTION 'Invalid Play purchase';
  END IF;
  -- Serialize both token ownership and parallel extensions by the same user.
  PERFORM pg_advisory_xact_lock(hashtextextended('play-token:' || _purchase_token, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('play-user:' || _user_id::text, 0));
  SELECT * INTO claim FROM public.play_purchase_claims WHERE purchase_token = _purchase_token;
  IF FOUND THEN
    IF claim.user_id <> _user_id OR (claim.product_id <> _product_id AND claim.product_id <> 'legacy') THEN
      RAISE EXCEPTION 'Purchase already belongs to another account or product';
    END IF;
    RETURN jsonb_build_object('expiresAt', claim.expires_at, 'alreadyGranted', true);
  END IF;
  IF _consumed THEN RAISE EXCEPTION 'Purchase was already consumed'; END IF;
  SELECT expires_at INTO expiry FROM public.user_subscriptions WHERE user_id = _user_id FOR UPDATE;
  expiry := greatest(now(), coalesce(expiry, now())) + make_interval(days => days);
  INSERT INTO public.play_purchase_claims (purchase_token, user_id, product_id, expires_at)
  VALUES (_purchase_token, _user_id, _product_id, expiry);
  INSERT INTO public.user_subscriptions (user_id, subscription_type, platform, purchase_token, transaction_id, expires_at, status, updated_at)
  VALUES (_user_id, 'premium_monthly', 'android', _purchase_token, _order_id, expiry, 'active', now())
  ON CONFLICT (user_id) DO UPDATE SET subscription_type = EXCLUDED.subscription_type,
    platform = EXCLUDED.platform, purchase_token = EXCLUDED.purchase_token,
    transaction_id = EXCLUDED.transaction_id, expires_at = EXCLUDED.expires_at,
    status = EXCLUDED.status, updated_at = EXCLUDED.updated_at;
  RETURN jsonb_build_object('expiresAt', expiry, 'alreadyGranted', false);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_verified_play_purchase(uuid, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_verified_play_purchase(uuid, text, text, text, boolean) TO service_role;
COMMENT ON TABLE public.play_purchase_claims IS 'Server-only permanent token ledger: verified purchases grant once even after later purchases replace the subscription token.';