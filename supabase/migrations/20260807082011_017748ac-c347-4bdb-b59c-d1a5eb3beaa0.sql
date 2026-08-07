DELETE FROM public.user_library WHERE user_id='9d8a0732-6d2b-481b-bbaa-7debd5c113d4';
INSERT INTO public.user_subscriptions (user_id, subscription_type, platform, status, expires_at)
SELECT '9d8a0732-6d2b-481b-bbaa-7debd5c113d4','premium_monthly','web','active', now() + interval '365 days'
WHERE NOT EXISTS (SELECT 1 FROM public.user_subscriptions WHERE user_id='9d8a0732-6d2b-481b-bbaa-7debd5c113d4' AND status='active');