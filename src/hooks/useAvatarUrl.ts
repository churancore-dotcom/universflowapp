import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';

// Profile photos live only on this device (local storage), never uploaded.
const cacheKey = (userId: string) => `uf_avatar_${userId}`;

const readLocal = (userId: string | undefined): string | null => {
  if (!userId || typeof window === 'undefined') return null;
  try {
    const v = localStorage.getItem(cacheKey(userId));
    return v && v.startsWith('data:') ? v : null;
  } catch {
    return null;
  }
};

export function useAvatarUrl(): string | null {
  const { user } = useAuth();
  const userId = user?.id;
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    setUrl(readLocal(userId));
    const onChange = () => setUrl(readLocal(userId));
    window.addEventListener('uf-avatar-changed', onChange);
    return () => window.removeEventListener('uf-avatar-changed', onChange);
  }, [userId]);

  return url;
}
