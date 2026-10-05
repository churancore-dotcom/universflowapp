CREATE OR REPLACE FUNCTION public.validate_payment_request_pricing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  expected_amount_paise integer;
  price_key text;
BEGIN
  price_key := CASE NEW.plan
    WHEN 'monthly' THEN 'premium_price_monthly_inr'
    WHEN 'bimonthly' THEN 'premium_price_bimonthly_inr'
    WHEN 'quarterly' THEN 'premium_price_quarterly_inr'
    ELSE NULL
  END;

  IF price_key IS NULL THEN
    RAISE EXCEPTION 'Invalid subscription plan';
  END IF;

  SELECT round((value #>> '{}')::numeric * 100)::integer
  INTO expected_amount_paise
  FROM public.app_settings
  WHERE key = price_key;

  IF expected_amount_paise IS NULL OR NEW.amount_paise <> expected_amount_paise THEN
    RAISE EXCEPTION 'Payment amount does not match the selected plan';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_payment_request_pricing_trigger ON public.payment_requests;
CREATE TRIGGER validate_payment_request_pricing_trigger
BEFORE INSERT OR UPDATE OF plan, amount_paise, status ON public.payment_requests
FOR EACH ROW
EXECUTE FUNCTION public.validate_payment_request_pricing();

REVOKE EXECUTE ON FUNCTION public.validate_payment_request_pricing() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_payment_request_pricing() TO service_role;