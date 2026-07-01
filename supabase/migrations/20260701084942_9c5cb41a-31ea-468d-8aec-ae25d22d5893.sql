GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT ON public.profiles TO anon;
GRANT ALL ON public.profiles TO service_role;