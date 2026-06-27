// Centralized helper that wraps an upstream audio URL with our edge-function
// proxy when (and only when) the WebAudio graph needs a CORS-clean response.
//
// The proxy serves identical bytes with proper `Access-Control-Allow-Origin`
// + `Accept-Ranges` headers, which lets `crossOrigin = "anonymous"` work and
// keeps `createMediaElementSource()` from permanently tainting the element.
//
// IMPORTANT: We do NOT proxy when EQ effects are flat. The raw `<audio>`
// element path is more reliable for Android background playback and avoids
// edge-function bandwidth cost. Routing through the proxy is opt-in via the
// `force` flag or by the EQ-active check in PlayerContext.

const STREAM_PROXY_PATH = '/functions/v1/stream-proxy';

const SAME_ORIGIN_HOST_SUFFIXES = ['supabase.co'];

function getProjectFunctionsBase(): string | null {
  const url = import.meta.env.VITE_SUPABASE_URL;
  if (!url) return null;
  try {
    const parsed = new URL(url);
    // Some deployments expose VITE_SUPABASE_URL as the API host, others as the
    // functions host. Normalize both so audio.src always points at the deployed
    // edge function; a malformed proxy URL silently breaks EQ attachment.
    if (parsed.hostname.endsWith('.functions.supabase.co')) {
      return `${parsed.protocol}//${parsed.hostname.replace('.functions.supabase.co', '.supabase.co')}`;
    }
    return `${parsed.protocol}//${parsed.host}`.replace(/\/$/, '');
  } catch {
    return url.replace(/\/$/, '');
  }
}

/** True if the URL is already pointing at our proxy. */
export function isStreamProxyUrl(url?: string | null): boolean {
  return Boolean(url?.includes(STREAM_PROXY_PATH));
}

/** Returns true for URLs we shouldn't proxy (already same-origin / supabase). */
function isAlreadyCorsClean(target: string): boolean {
  try {
    const parsed = new URL(target, typeof window !== 'undefined' ? window.location.href : 'http://localhost');
    if (typeof window !== 'undefined' && parsed.origin === window.location.origin) return true;
    return SAME_ORIGIN_HOST_SUFFIXES.some((suffix) => parsed.hostname.endsWith(suffix));
  } catch {
    return true; // unparseable URLs are not our problem
  }
}

/**
 * Wrap an upstream audio URL with the stream-proxy edge function.
 * Returns the original URL unchanged when proxying is unnecessary or
 * impossible (no project URL configured, blob/data scheme, etc.).
 */
export function wrapStreamUrl(target: string, options?: { force?: boolean }): string {
  if (!target || !target.startsWith('http')) return target;
  if (isStreamProxyUrl(target)) return target;
  if (!options?.force && isAlreadyCorsClean(target)) return target;
  const base = getProjectFunctionsBase();
  if (!base) return target;
  return `${base}${STREAM_PROXY_PATH}?u=${encodeURIComponent(target)}`;
}
