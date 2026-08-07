INSERT INTO public.user_subscriptions (user_id, subscription_type, status, platform, expires_at)
SELECT '9d8a0732-6d2b-481b-bbaa-7debd5c113d4'::uuid, 'premium_monthly', 'active', 'web', now() + interval '2 days'
WHERE NOT EXISTS (
  SELECT 1 FROM public.user_subscriptions WHERE user_id = '9d8a0732-6d2b-481b-bbaa-7debd5c113d4'::uuid
);