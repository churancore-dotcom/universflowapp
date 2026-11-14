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
  const [state, setState] = useState<{ userId: string | null; prefs: UserArtistPref[]; loading: boolean }>({ userId: null, prefs: [], loading: true });

  useEffect(() => {
    let cancelled = false;
    let request = 0;
    if (!user) { setState({ userId: null, prefs: [], loading: false }); return; }
    setState({ userId: user.id, prefs: [], loading: true });

    const load = (force = false) => {
      const mine = ++request;
      getUserArtistPrefs(user.id, force).then((p) => {
        if (cancelled || mine !== request) return;
        setState({ userId: user.id, prefs: p, loading: false });
      }).catch(() => {
        if (!cancelled && mine === request) setState({ userId: user.id, prefs: [], loading: false });
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

  const matches = state.userId === (user?.id ?? null);
  const prefs = matches ? state.prefs : [];
  return { prefs, loading: user ? !matches || state.loading : false, names: prefs.map((p) => p.artist_name).filter(Boolean) };
}
