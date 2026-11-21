CREATE OR REPLACE FUNCTION public.admin_review_payment_request(p_request_id uuid, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_req public.payment_requests%ROWTYPE;
  v_expires timestamptz; v_type public.subscription_type; v_base timestamptz; v_days integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  IF p_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid review status';
  END IF;

  SELECT * INTO v_req FROM public.payment_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment request not found'; END IF;
  -- One review per payment: re-approving would add Premium days twice.
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'This payment was already reviewed';
  END IF;

  v_days := CASE v_req.plan WHEN 'monthly' THEN 30 WHEN 'bimonthly' THEN 60 WHEN 'quarterly' THEN 90 ELSE NULL END;
  IF p_status = 'approved' AND v_days IS NULL THEN
    RAISE EXCEPTION 'Unknown Premium plan';
  END IF;

  PERFORM set_config('request.skip_payment_grant', '1', true);
  UPDATE public.payment_requests
  SET status = p_status, reviewed_at = now(), updated_at = now()
  WHERE id = p_request_id AND status = 'pending'
  RETURNING * INTO v_req;
  IF NOT FOUND THEN RAISE EXCEPTION 'This payment was already reviewed'; END IF;

  IF p_status = 'approved' THEN
    SELECT GREATEST(now(), COALESCE(us.expires_at, now())) INTO v_base
      FROM public.user_subscriptions us WHERE us.user_id = v_req.user_id LIMIT 1;
    v_base := COALESCE(v_base, now());
    v_expires := v_base + make_interval(days => v_days);
    v_type := 'premium_monthly'::public.subscription_type;

    INSERT INTO public.user_subscriptions (user_id, subscription_type, status, expires_at, platform)
    VALUES (v_req.user_id, v_type, 'active', v_expires, 'web')
    ON CONFLICT (user_id) DO UPDATE SET
      subscription_type = EXCLUDED.subscription_type, status = 'active',
      expires_at = GREATEST(public.user_subscriptions.expires_at, EXCLUDED.expires_at),
      platform = 'web', updated_at = now();
  END IF;

  RETURN jsonb_build_object('success', true, 'status', p_status, 'user_id', v_req.user_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.grant_premium_on_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_expires timestamptz;
  v_base timestamptz;
  v_days integer;
BEGIN
  -- A reviewed payment is final; reopening it could grant Premium again.
  IF TG_OP = 'UPDATE' AND OLD.status <> 'pending' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'This payment was already reviewed';
  END IF;

  IF current_setting('request.skip_payment_grant', true) = '1' THEN
    NEW.reviewed_at = COALESCE(NEW.reviewed_at, now());
    RETURN NEW;
  END IF;

  IF NEW.status IN ('approved','auto_approved')
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    v_days := CASE NEW.plan WHEN 'monthly' THEN 30 WHEN 'bimonthly' THEN 60 WHEN 'quarterly' THEN 90 ELSE NULL END;
    IF v_days IS NULL THEN RAISE EXCEPTION 'Unknown Premium plan'; END IF;

    SELECT GREATEST(now(), COALESCE(us.expires_at, now()))
      INTO v_base
      FROM public.user_subscriptions us
      WHERE us.user_id = NEW.user_id
      LIMIT 1;
    v_base := COALESCE(v_base, now());
    v_expires := v_base + make_interval(days => v_days);

    INSERT INTO public.user_subscriptions (user_id, subscription_type, status, expires_at, platform)
    VALUES (NEW.user_id, 'premium_monthly'::public.subscription_type, 'active', v_expires, 'web')
    ON CONFLICT (user_id) DO UPDATE SET
      subscription_type = EXCLUDED.subscription_type,
      status = 'active',
      expires_at = GREATEST(public.user_subscriptions.expires_at, EXCLUDED.expires_at),
      platform = 'web',
      updated_at = now();

    NEW.reviewed_at = COALESCE(NEW.reviewed_at, now());
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.notify_system_push(uuid[], text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_system_push(uuid[], text, text, text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.expire_old_subscriptions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_old_subscriptions() TO service_role;