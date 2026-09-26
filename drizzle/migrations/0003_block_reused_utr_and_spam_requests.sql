CREATE UNIQUE INDEX IF NOT EXISTS payment_requests_utr_unique
  ON public.payment_requests (upper(regexp_replace(utr_number, '\s', '', 'g')))
  WHERE status <> 'rejected';
CREATE UNIQUE INDEX IF NOT EXISTS payment_requests_one_pending_per_user
  ON public.payment_requests (user_id) WHERE status = 'pending';
ALTER TABLE public.payment_requests DROP CONSTRAINT IF EXISTS payment_requests_utr_format;
ALTER TABLE public.payment_requests ADD CONSTRAINT payment_requests_utr_format
  CHECK (regexp_replace(utr_number, '\s', '', 'g') ~ '^[A-Za-z0-9]{10,22}$') NOT VALID;