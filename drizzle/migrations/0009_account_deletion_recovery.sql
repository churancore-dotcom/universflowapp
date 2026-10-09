CREATE TABLE public.account_deletion_requests (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  requested_at timestamptz NOT NULL DEFAULT now(),
  delete_after timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  cancelled_at timestamptz,
  completed_at timestamptz,
  CONSTRAINT account_deletion_seven_day_window CHECK (delete_after >= requested_at + interval '7 days')
);

GRANT SELECT, INSERT, UPDATE ON public.account_deletion_requests TO authenticated;
GRANT ALL ON public.account_deletion_requests TO service_role;

ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own deletion request"
ON public.account_deletion_requests
FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can request own deletion"
ON public.account_deletion_requests
FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id AND cancelled_at IS NULL AND completed_at IS NULL);

CREATE POLICY "Users can cancel own pending deletion"
ON public.account_deletion_requests
FOR UPDATE TO authenticated
USING (auth.uid() = user_id AND completed_at IS NULL AND delete_after > now())
WITH CHECK (auth.uid() = user_id AND cancelled_at IS NOT NULL AND completed_at IS NULL);

CREATE OR REPLACE FUNCTION public.request_account_deletion()
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deadline timestamptz := now() + interval '7 days';
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  INSERT INTO public.account_deletion_requests (user_id, requested_at, delete_after, cancelled_at, completed_at)
  VALUES (auth.uid(), now(), deadline, NULL, NULL)
  ON CONFLICT (user_id) DO UPDATE
  SET requested_at = now(),
      delete_after = deadline,
      cancelled_at = NULL,
      completed_at = NULL;

  RETURN deadline;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_account_deletion()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  UPDATE public.account_deletion_requests
  SET cancelled_at = now()
  WHERE user_id = auth.uid()
    AND completed_at IS NULL
    AND cancelled_at IS NULL
    AND delete_after > now();

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.request_account_deletion() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_account_deletion() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_account_deletion() TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_account_deletion() TO authenticated;

CREATE INDEX account_deletion_due_idx
ON public.account_deletion_requests (delete_after)
WHERE cancelled_at IS NULL AND completed_at IS NULL;