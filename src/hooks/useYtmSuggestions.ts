import { useEffect, useRef, useState } from 'react';
import { getYtmSuggestions } from '@/lib/ytmSuggestions.functions';
import type { YtmSuggestions } from '@/lib/ytmSuggestions';
import { detectCountrySilently } from '@/lib/geoCountry';

const EMPTY: YtmSuggestions = { queries: [], items: [] };
const cache = new Map<string, YtmSuggestions>();

/** Never trust the reply's shape: a bad reply must not crash the Search screen. */
export function normalizeSuggestions(res: unknown): YtmSuggestions {
  const r = (res && typeof res === 'object') ? res as Partial<YtmSuggestions> : {};
  const queries = Array.isArray(r.queries) ? r.queries.filter((q): q is string => typeof q === 'string' && q.trim().length > 0) : [];
  const items = Array.isArray(r.items)
    ? r.items.filter((it) => it && typeof it === 'object' && typeof it.title === 'string' && it.title.length > 0)
        .map((it) => ({ ...it, subtitle: typeof it.subtitle === 'string' ? it.subtitle : '' }))
    : [];
  return { queries: [...new Set(queries)], items };
}

/** Debounced YouTube Music typing suggestions (terms + songs/artists). */
export function useYtmSuggestions(query: string, enabled = true): YtmSuggestions {
  const [value, setValue] = useState<YtmSuggestions>(EMPTY);
  const seq = useRef(0);

  useEffect(() => {
    const mine = ++seq.current; // invalidate any in-flight request
    const q = query.trim();
    if (!enabled || q.length < 1) { setValue(EMPTY); return; }
    setValue(EMPTY);
    const t = setTimeout(async () => {
      try {
        const gl = (await detectCountrySilently().catch(() => 'US')).toUpperCase();
        if (mine !== seq.current) return;
        const market = /^[A-Z]{2}$/.test(gl) ? gl : 'US';
        const key = `${market}:${q.toLowerCase()}`;
        const hit = cache.get(key);
        if (hit) { setValue(hit); return; }
        const res = normalizeSuggestions(await getYtmSuggestions({ data: { q, gl: market } }));
        if (cache.size >= 100) { const oldest = cache.keys().next().value; if (oldest !== undefined) cache.delete(oldest); }
        cache.set(key, res);
        if (mine === seq.current) setValue(res);
      } catch { if (mine === seq.current) setValue(EMPTY); }
    }, 120);
    return () => { clearTimeout(t); if (seq.current === mine) seq.current++; };
  }, [query, enabled]);

  return value;
}
