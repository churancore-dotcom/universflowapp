CREATE OR REPLACE FUNCTION public.validate_payment_request_pricing()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  expected_amount_paise integer;
  price_key text;
BEGIN
  price_key := CASE NEW.plan
    WHEN 'monthly' THEN 'premium_price_monthly_inr'
    WHEN 'bimonthly' THEN 'premium_price_bimonthly_inr'
    WHEN 'quarterly' THEN 'premium_price_quarterly_inr'
    ELSE NULL END;
  IF price_key IS NULL THEN RAISE EXCEPTION 'Invalid subscription plan'; END IF;
  SELECT round((value #>> '{}')::numeric * 100)::integer INTO expected_amount_paise
  FROM public.app_settings WHERE key = price_key;
  -- Checkout adds 1-99 unique paise per user so payments can be matched.
  IF expected_amount_paise IS NULL
     OR NEW.amount_paise < expected_amount_paise
     OR NEW.amount_paise > expected_amount_paise + 99 THEN
    RAISE EXCEPTION 'Payment amount does not match the selected plan';
  END IF;
  RETURN NEW;
END; $$;