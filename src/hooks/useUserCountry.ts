// Silent country resolution for feed personalization (Spotify-style).
// Priority: profile.country_code → silent edge IP geo → browser region tag.
// No hard-coded country fallback — empty string means "Global feed".
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { detectCountrySilently } from '@/lib/geoCountry';

const SESSION_KEY = 'uf-feed-country';
// Persisted across launches: a cold open must not start on the Global feed for
// a listener whose real market we already know — that first paint is what made
// trending look like the same market for everybody.
const PERSIST_KEY = 'uf-feed-country.v1';

export function useUserCountry(): string {
  const { user } = useAuth();
  const [country, setCountry] = useState<string>(() => {
    try {
      const cached = sessionStorage.getItem(SESSION_KEY);
      if (cached && /^[A-Z]{2}$/.test(cached)) return cached;
      const stored = localStorage.getItem(PERSIST_KEY);
      if (stored && /^[A-Z]{2}$/.test(stored)) return stored;
    } catch {}
    return '';
  });


  useEffect(() => {
    let cancelled = false;
    (async () => {
      let cc: string | null = null;

      if (user?.id) {
        try {
          const { data } = await supabase
            .from('profiles')
            .select('country_code')
            .eq('user_id', user.id)
            .maybeSingle();
          const raw = (data?.country_code || '').toUpperCase();
          if (/^[A-Z]{2}$/.test(raw)) cc = raw;
        } catch {}
      }

      if (!cc) {
        try {
          cc = (await detectCountrySilently()) || null;
        } catch { /* noop */ }
      }

      // No hard-coded country fallback: empty string means
      // "Global feed" downstream, never silently forces US/IN.
      if (cancelled) return;
      const final = cc || '';
      if (final) {
        try { sessionStorage.setItem(SESSION_KEY, final); } catch { /* noop */ }
      }
      setCountry(final);
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  return country;
}
