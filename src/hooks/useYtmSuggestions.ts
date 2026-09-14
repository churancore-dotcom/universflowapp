import { useEffect, useRef, useState } from 'react';
import { searchSongsAsTracks } from '@/lib/jiosaavn';

/**
 * Debounced catalogue suggestions from real JioSaavn tracks and artists.
 * Returns a stable array of up to 10 suggestion strings.
 */
export function useYtmSuggestions(query: string, enabled = true) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const ctrlRef = useRef<AbortController | null>(null);
  const lastQueryRef = useRef('');

  useEffect(() => {
    const q = query.trim();
    if (!enabled || q.length < 2) {
      setSuggestions([]);
      return;
    }
    if (q === lastQueryRef.current) return;
    const t = setTimeout(async () => {
      ctrlRef.current?.abort();
      const ctrl = new AbortController();
      ctrlRef.current = ctrl;
      lastQueryRef.current = q;
      try {
        const tracks = await searchSongsAsTracks(q, 12);
        if (ctrl.signal.aborted) return;
        const list = tracks.flatMap((track) => [track.title, track.artist]).filter(Boolean);
        setSuggestions([...new Set(list)].slice(0, 10));
      } catch {
        if (!ctrl.signal.aborted) setSuggestions([]);
      }
    }, 180);
    return () => clearTimeout(t);
  }, [query, enabled]);

  return suggestions;
}
