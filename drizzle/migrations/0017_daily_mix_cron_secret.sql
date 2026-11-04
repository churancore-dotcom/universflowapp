DO $$
BEGIN
  PERFORM cron.unschedule('daily-mix-builder-04-10-utc');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'daily-mix-builder-04-10-utc',
  '10 4 * * *',
  $cmd$
    SELECT net.http_post(
      url := 'https://kzaeahjeqlihmxrfhjqd.supabase.co/functions/v1/daily-mix-builder',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (SELECT btrim(value, '"') FROM public.internal_secrets WHERE key = 'chart_aggregator_cron_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 55000
    );
  $cmd$
);