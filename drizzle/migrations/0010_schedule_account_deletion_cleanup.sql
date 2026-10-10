CREATE OR REPLACE FUNCTION public.invoke_account_deletion_cleanup()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  cleanup_token text;
BEGIN
  SELECT value INTO cleanup_token
  FROM public.internal_secrets
  WHERE key = 'account_deletion_cron_token';

  IF cleanup_token IS NULL OR cleanup_token = '' THEN
    RAISE NOTICE 'Account deletion cleanup token is not configured';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://universflow.in/api/public/process-account-deletions',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', cleanup_token
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_account_deletion_cleanup() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_account_deletion_cleanup() TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('process-account-deletions');
EXCEPTION WHEN OTHERS THEN
  NULL;
END$$;

SELECT cron.schedule(
  'process-account-deletions',
  '15 * * * *',
  $$SELECT public.invoke_account_deletion_cleanup();$$
);