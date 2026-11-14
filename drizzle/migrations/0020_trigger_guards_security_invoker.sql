-- These guard triggers decide "privileged caller" via current_user. As
-- SECURITY DEFINER, current_user is always the owner (postgres), so the guards
-- never applied. As SECURITY INVOKER, current_user is the real caller role
-- (authenticated for app users; postgres inside trusted definer RPCs).
ALTER FUNCTION public.prevent_support_chat_tamper() SECURITY INVOKER;
ALTER FUNCTION public.enforce_friends_pending_on_insert() SECURITY INVOKER;
ALTER FUNCTION public.prevent_friends_recipient_column_change() SECURITY INVOKER;
ALTER FUNCTION public.prevent_artist_profile_privileged_change() SECURITY INVOKER;
ALTER FUNCTION public.prevent_artist_song_privileged_change() SECURITY INVOKER;
ALTER FUNCTION public.prevent_email_verified_change() SECURITY INVOKER;
ALTER FUNCTION public.prevent_playlist_privileged_change() SECURITY INVOKER;
ALTER FUNCTION public.prevent_artist_application_privileged_change() SECURITY INVOKER;
ALTER FUNCTION public.prevent_artist_song_privileged_insert() SECURITY INVOKER;
ALTER FUNCTION public.prevent_artist_application_privileged_insert() SECURITY INVOKER;
ALTER FUNCTION public.prevent_experiment_assignment_tamper() SECURITY INVOKER;
ALTER FUNCTION public.prevent_profile_sensitive_change() SECURITY INVOKER;
ALTER FUNCTION public.prevent_song_dedication_recipient_column_change() SECURITY INVOKER;