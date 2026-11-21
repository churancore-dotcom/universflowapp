REVOKE EXECUTE ON FUNCTION public.publish_due_scheduled_songs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_due_scheduled_songs() TO service_role;