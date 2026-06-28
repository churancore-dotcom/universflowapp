-- Revoke column-level SELECT on stream_url from anon so unauthenticated visitors
-- cannot scrape direct audio URLs from public artist pages. Authenticated
-- listeners (and admins/owners) keep full access via existing RLS policies.
REVOKE SELECT (stream_url) ON public.artist_songs FROM anon;