import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

// Same cache key as the Profile page so an upload there shows here instantly.
const cacheKey = (userId: string) => `uf_avatar_${userId}`;

const readCached = (userId: string | undefined): string | null => {
  if (!userId || typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(cacheKey(userId));
  } catch {
    return null;
  }
};

/**
 * The signed URL for the current user's private avatar photo.
 * Paints the last cached URL immediately, then refreshes from the profile row.
 */
export function useAvatarUrl(): string | null {
  const { user } = useAuth();
  const userId = user?.id;
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    setUrl(readCached(userId));
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('avatar_url')
        .eq('user_id', userId)
        .maybeSingle();
      const path = data?.avatar_url;
      if (!path) {
        try {
          localStorage.removeItem(cacheKey(userId));
        } catch {
          /* noop */
        }
        if (!cancelled) setUrl(null);
        return;
      }
      const { data: signed, error } = await supabase.storage
        .from('avatars')
        .createSignedUrl(path, 60 * 60 * 24 * 7);
      if (cancelled || error || !signed?.signedUrl) return;
      try {
        localStorage.setItem(cacheKey(userId), signed.signedUrl);
      } catch {
        /* noop */
      }
      setUrl(signed.signedUrl);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return url;
}
