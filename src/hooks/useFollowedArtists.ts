import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getUserArtistPrefs, type UserArtistPref } from '@/lib/userArtistPrefs';

/**
 * Single source of truth for "artists this user follows".
 *
 * Every follow/unfollow anywhere in the app clears the module cache and fires
 * `uf:artist-prefs-changed`, so every mounted consumer re-reads immediately —
 * no refresh, no stale rail, no waiting on react-query staleTime.
 */
export function useFollowedArtists() {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<UserArtistPref[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!user) { setPrefs([]); setLoading(false); return; }

    const load = (force = false) => {
      getUserArtistPrefs(user.id, force).then((p) => {
        if (cancelled) return;
        setPrefs(p);
        setLoading(false);
      });
    };

    load();
    const onChange = () => load(true);
    window.addEventListener('uf:artist-prefs-changed', onChange);
    return () => {
      cancelled = true;
      window.removeEventListener('uf:artist-prefs-changed', onChange);
    };
  }, [user?.id]);

  return { prefs, loading, names: prefs.map((p) => p.artist_name).filter(Boolean) };
}
