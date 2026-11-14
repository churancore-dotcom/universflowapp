import { useEffect, useRef, useState } from 'react';
import { getYtmSuggestions } from '@/lib/ytmSuggestions.functions';
import type { YtmSuggestions } from '@/lib/ytmSuggestions';
import { detectCountrySilently } from '@/lib/geoCountry';

const EMPTY: YtmSuggestions = { queries: [], items: [] };
const cache = new Map<string, YtmSuggestions>();

/** Debounced YouTube Music typing suggestions (terms + songs/artists). */
export function useYtmSuggestions(query: string, enabled = true): YtmSuggestions {
  const [value, setValue] = useState<YtmSuggestions>(EMPTY);
  const seq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (!enabled || q.length < 1) { setValue(EMPTY); return; }
    const key = q.toLowerCase();
    const hit = cache.get(key);
    if (hit) { setValue(hit); return; }
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const gl = (await detectCountrySilently().catch(() => 'US')).toUpperCase();
        const res = await getYtmSuggestions({ data: { q, gl: /^[A-Z]{2}$/.test(gl) ? gl : 'US' } });
        cache.set(key, res);
        if (mine === seq.current) setValue(res);
      } catch { /* keep previous */ }
    }, 120);
    return () => clearTimeout(t);
  }, [query, enabled]);

  return value;
}
