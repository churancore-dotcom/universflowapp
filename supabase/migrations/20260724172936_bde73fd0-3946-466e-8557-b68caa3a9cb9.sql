
-- 1. New columns on artist_songs
ALTER TABLE public.artist_songs
  ADD COLUMN IF NOT EXISTS featured_artists text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS language text,
  ADD COLUMN IF NOT EXISTS mood_tags text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS is_explicit boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS milestone_reached bigint NOT NULL DEFAULT 0;

-- 2. artist_payouts table
CREATE TABLE IF NOT EXISTS public.artist_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_user_id uuid NOT NULL,
  streams_count bigint NOT NULL DEFAULT 0,
  amount_inr numeric(12,2) NOT NULL DEFAULT 0,
  amount_usd numeric(12,2) NOT NULL DEFAULT 0,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','paid','rejected')),
  upi_id text,
  admin_note text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.artist_payouts TO authenticated;
GRANT ALL ON public.artist_payouts TO service_role;

ALTER TABLE public.artist_payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Artist reads own payouts"
  ON public.artist_payouts FOR SELECT
  TO authenticated
  USING (artist_user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admin manages payouts"
  ON public.artist_payouts FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE INDEX IF NOT EXISTS idx_artist_payouts_artist ON public.artist_payouts(artist_user_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_artist_payouts_status ON public.artist_payouts(status) WHERE status IN ('pending','processing');

CREATE TRIGGER trg_artist_payouts_updated_at
  BEFORE UPDATE ON public.artist_payouts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Milestone push trigger on artist_songs
CREATE OR REPLACE FUNCTION public.check_artist_song_milestones()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_next bigint;
  v_ms bigint;
  v_thresholds bigint[] := ARRAY[100, 1000, 10000, 100000, 1000000, 10000000];
BEGIN
  IF NEW.play_count IS NULL OR NEW.play_count = OLD.play_count THEN RETURN NEW; END IF;
  v_next := 0;
  FOREACH v_ms IN ARRAY v_thresholds LOOP
    IF NEW.play_count >= v_ms AND OLD.milestone_reached < v_ms THEN
      v_next := v_ms;
    END IF;
  END LOOP;
  IF v_next > 0 THEN
    NEW.milestone_reached := v_next;
    BEGIN
      PERFORM public.notify_system_push(
        ARRAY[NEW.artist_user_id]::uuid[],
        '🎉 ' || CASE
          WHEN v_next >= 1000000 THEN (v_next/1000000)::text || 'M streams'
          WHEN v_next >= 1000 THEN (v_next/1000)::text || 'K streams'
          ELSE v_next::text || ' streams'
        END,
        '"' || COALESCE(NEW.title,'Your song') || '" just hit ' || v_next::text || ' streams on Universflow.',
        '/artist/studio'
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'milestone push failed: %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_artist_song_milestones ON public.artist_songs;
CREATE TRIGGER trg_artist_song_milestones
  BEFORE UPDATE OF play_count ON public.artist_songs
  FOR EACH ROW EXECUTE FUNCTION public.check_artist_song_milestones();

-- 4. New-follower push (throttled 1h) on artist_followers
CREATE OR REPLACE FUNCTION public.push_new_follower()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_last timestamptz;
  v_extra int;
  v_name text;
BEGIN
  IF NEW.artist_user_id = NEW.follower_user_id THEN RETURN NEW; END IF;

  INSERT INTO public.artist_push_throttle(artist_user_id, event_kind, last_notified_at, count_since_last)
  VALUES (NEW.artist_user_id, 'new_follower', 'epoch'::timestamptz, 1)
  ON CONFLICT (artist_user_id, event_kind) DO UPDATE
    SET count_since_last = public.artist_push_throttle.count_since_last + 1
  RETURNING last_notified_at, count_since_last INTO v_last, v_extra;

  IF v_last > now() - interval '1 hour' THEN RETURN NEW; END IF;

  SELECT COALESCE(username,'Someone') INTO v_name FROM public.profiles WHERE user_id = NEW.follower_user_id;

  BEGIN
    PERFORM public.notify_system_push(
      ARRAY[NEW.artist_user_id]::uuid[],
      CASE WHEN v_extra > 1 THEN '👥 ' || v_extra::text || ' new followers' ELSE '👥 New follower' END,
      CASE WHEN v_extra > 1 THEN v_name || ' and ' || (v_extra-1)::text || ' more started following you'
           ELSE v_name || ' started following you' END,
      '/artist/studio'
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'follower push failed: %', SQLERRM;
  END;

  UPDATE public.artist_push_throttle
    SET last_notified_at = now(), count_since_last = 0
    WHERE artist_user_id = NEW.artist_user_id AND event_kind = 'new_follower';

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_push_new_follower ON public.artist_followers;
CREATE TRIGGER trg_push_new_follower
  AFTER INSERT ON public.artist_followers
  FOR EACH ROW EXECUTE FUNCTION public.push_new_follower();

-- 5. Earnings summary RPC
CREATE OR REPLACE FUNCTION public.get_artist_earnings_summary(_artist_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_total_streams bigint;
  v_paid_streams bigint;
  v_pending_streams bigint;
  v_unpaid_streams bigint;
  v_rate_inr numeric := 0.025; -- ₹25 per 1000 streams
  v_rate_usd numeric := 0.003;
BEGIN
  IF NOT (auth.uid() = _artist_user_id OR public.has_role(auth.uid(), 'admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(SUM(play_count),0) INTO v_total_streams
    FROM public.artist_songs WHERE artist_user_id = _artist_user_id;

  SELECT COALESCE(SUM(streams_count),0) INTO v_paid_streams
    FROM public.artist_payouts
    WHERE artist_user_id = _artist_user_id AND status = 'paid';

  SELECT COALESCE(SUM(streams_count),0) INTO v_pending_streams
    FROM public.artist_payouts
    WHERE artist_user_id = _artist_user_id AND status IN ('pending','processing');

  v_unpaid_streams := GREATEST(v_total_streams - v_paid_streams - v_pending_streams, 0);

  RETURN jsonb_build_object(
    'total_streams', v_total_streams,
    'paid_streams', v_paid_streams,
    'pending_streams', v_pending_streams,
    'unpaid_streams', v_unpaid_streams,
    'unpaid_amount_inr', round(v_unpaid_streams * v_rate_inr, 2),
    'unpaid_amount_usd', round(v_unpaid_streams * v_rate_usd, 2),
    'lifetime_amount_inr', round(v_total_streams * v_rate_inr, 2),
    'lifetime_amount_usd', round(v_total_streams * v_rate_usd, 2),
    'min_payout_inr', 500,
    'rate_per_1000_inr', 25
  );
END $$;

-- 6. Request payout RPC
CREATE OR REPLACE FUNCTION public.request_artist_payout(_upi_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_summary jsonb;
  v_unpaid_streams bigint;
  v_amount_inr numeric;
  v_amount_usd numeric;
  v_payout_id uuid;
  v_upi text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Login required' USING ERRCODE = '28000';
  END IF;

  v_upi := NULLIF(BTRIM(_upi_id), '');
  IF v_upi IS NULL OR v_upi !~ '^[a-zA-Z0-9._-]{2,64}@[a-zA-Z]{2,32}$' THEN
    RAISE EXCEPTION 'Invalid UPI id' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.artist_payouts
    WHERE artist_user_id = v_uid AND status IN ('pending','processing')
  ) THEN
    RAISE EXCEPTION 'You already have a payout in progress' USING ERRCODE = '23505';
  END IF;

  v_summary := public.get_artist_earnings_summary(v_uid);
  v_unpaid_streams := (v_summary->>'unpaid_streams')::bigint;
  v_amount_inr := (v_summary->>'unpaid_amount_inr')::numeric;
  v_amount_usd := (v_summary->>'unpaid_amount_usd')::numeric;

  IF v_amount_inr < 500 THEN
    RAISE EXCEPTION 'Minimum payout is ₹500. Current balance: ₹%', v_amount_inr USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.artist_payouts(
    artist_user_id, streams_count, amount_inr, amount_usd,
    period_start, period_end, status, upi_id
  ) VALUES (
    v_uid, v_unpaid_streams, v_amount_inr, v_amount_usd,
    now() - interval '30 days', now(), 'pending', v_upi
  ) RETURNING id INTO v_payout_id;

  RETURN jsonb_build_object('success', true, 'payout_id', v_payout_id, 'amount_inr', v_amount_inr);
END $$;

-- 7. Admin mark paid RPC
CREATE OR REPLACE FUNCTION public.admin_mark_payout_paid(_payout_id uuid, _admin_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_row public.artist_payouts%ROWTYPE;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = '42501';
  END IF;
  UPDATE public.artist_payouts
    SET status = 'paid', paid_at = now(), admin_note = COALESCE(_admin_note, admin_note), updated_at = now()
    WHERE id = _payout_id AND status IN ('pending','processing')
    RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payout not found or already finalized'; END IF;

  PERFORM public.admin_log_event('payout_paid','info', jsonb_build_object('payout_id', _payout_id, 'artist_user_id', v_row.artist_user_id, 'amount_inr', v_row.amount_inr));

  BEGIN
    PERFORM public.notify_system_push(
      ARRAY[v_row.artist_user_id]::uuid[],
      '💰 Payout sent',
      '₹' || v_row.amount_inr::text || ' has been transferred to ' || COALESCE(v_row.upi_id,'your UPI'),
      '/artist/earnings'
    );
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object('success', true);
END $$;
