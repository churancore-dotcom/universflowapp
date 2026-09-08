/**
 * Recent search terms, stored on the device so the search screen has real
 * one-tap history on mobile (survives app restarts inside the APK WebView).
 */
const KEY = 'uf_recent_queries';
const MAX = 12;

export function readRecentQueries(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((q) => typeof q === 'string' && q.trim()).slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function rememberQuery(query: string): string[] {
  const term = query.trim();
  if (typeof window === 'undefined' || term.length < 2) return readRecentQueries();
  const next = [term, ...readRecentQueries().filter((q) => q.toLowerCase() !== term.toLowerCase())].slice(0, MAX);
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage full */ }
  return next;
}

export function forgetQuery(query: string): string[] {
  const next = readRecentQueries().filter((q) => q.toLowerCase() !== query.trim().toLowerCase());
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}

export function clearRecentQueries(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
