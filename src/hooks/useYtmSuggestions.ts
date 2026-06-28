import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Debounced YT Music search suggestions.
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
        const { data, error } = await supabase.functions.invoke('ytm-suggest', {
          body: { query: q },
        });
        if (ctrl.signal.aborted) return;
        if (error || !data?.success) {
          setSuggestions([]);
          return;
        }
        const list: string[] = Array.isArray(data.suggestions) ? data.suggestions : [];
        setSuggestions(list.slice(0, 10));
      } catch {
        if (!ctrl.signal.aborted) setSuggestions([]);
      }
    }, 180);
    return () => clearTimeout(t);
  }, [query, enabled]);

  return suggestions;
}
