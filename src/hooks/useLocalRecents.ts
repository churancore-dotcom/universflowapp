import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { readLocalRecent, type LocalRecentEntry } from '@/lib/localRecentlyPlayed';

/**
 * Device-local play history, live. Reads on the client only (localStorage does
 * not exist during SSR) and re-reads whenever a play is recorded, so every
 * personal Home shelf shares one source of truth instead of a stale snapshot.
 */
export function useLocalRecents(limit = 60): LocalRecentEntry[] {
  const { user } = useAuth();
  const [version, setVersion] = useState(0);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
    const refresh = () => setVersion((v) => v + 1);
    window.addEventListener('universflow:recently-played-changed', refresh);
    return () => window.removeEventListener('universflow:recently-played-changed', refresh);
  }, []);

  return useMemo(
    () => (hydrated ? readLocalRecent(user?.id ?? null).slice(0, limit) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hydrated, version, user?.id, limit],
  );
}
