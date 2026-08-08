import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { getTasteProfile, invalidateTasteProfile, type TasteProfile } from '@/lib/feedPersonalizer';

const EMPTY: TasteProfile = { artists: new Map(), keywords: new Map(), skips: new Map(), signalCount: 0 };

/**
 * Silent personalization hook — returns the user's listening-taste profile.
 *
 * The profile is rebuilt whenever the user actually gives a signal (like,
 * follow, play), so the feed reflects the last thing they did instead of an
 * hour-old snapshot. Between signals it stays cached so concurrent shelves
 * share one DB hit.
 */
export function useTasteProfile(): TasteProfile {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ['taste-profile', user?.id ?? 'anon'],
    queryFn: () => getTasteProfile(user?.id ?? null),
    // Signed-out listeners still get a device-local profile, so the very first
    // session already shapes the feed instead of showing everyone the same rows.
    staleTime: 5 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
  });


  useEffect(() => {

    const refresh = () => {
      invalidateTasteProfile();
      queryClient.invalidateQueries({ queryKey: ['taste-profile'] });
    };
    window.addEventListener('uf:likes-changed', refresh);
    window.addEventListener('uf:artist-prefs-changed', refresh);
    window.addEventListener('universflow:recently-played-changed', refresh);
    return () => {
      window.removeEventListener('uf:likes-changed', refresh);
      window.removeEventListener('uf:artist-prefs-changed', refresh);
      window.removeEventListener('universflow:recently-played-changed', refresh);
    };
  }, [user?.id, queryClient]);

  return data ?? EMPTY;
}
