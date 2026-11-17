/**
 * The APK serves its pages from https://localhost inside the phone, where no
 * server exists. Server-function calls there would get the app's own HTML page
 * back instead of data (which crashed Search on the first keystroke). On the
 * phone, send them to the live website instead, through native HTTP so the
 * WebView's cross-site rules don't block them.
 */
export const NATIVE_SERVER_ORIGIN = 'https://universflow.in';

type CapLike = { isNativePlatform?: () => boolean };

export function isBundledNativeShell(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as unknown as { Capacitor?: CapLike }).Capacitor;
  if (!cap?.isNativePlatform?.()) return false;
  // A dev phone pointed at a live server (server.url) can use relative URLs.
  return window.location.hostname === 'localhost';
}

/** Resolve a relative server-function URL to the live website. */
export function toNativeServerUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return NATIVE_SERVER_ORIGIN + (url.startsWith('/') ? url : `/${url}`);
}

function headersToObject(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(h).forEach((v, k) => { out[k] = v; });
  return out;
}

export async function nativeServerFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!isBundledNativeShell()) return fetch(input, init);
  const url = toNativeServerUrl(rawUrl);
  if (init?.body != null && typeof init.body !== 'string') {
    // Non-JSON bodies (FormData) aren't supported over native HTTP here.
    return fetch(url, init);
  }
  const { CapacitorHttp } = await import('@capacitor/core');
  const headers = headersToObject(init?.headers);
  // The site only accepts server calls that come from its own pages.
  headers['origin'] = NATIVE_SERVER_ORIGIN;
  headers['referer'] = `${NATIVE_SERVER_ORIGIN}/`;
  init?.signal?.throwIfAborted();
  const res = await CapacitorHttp.request({
    url,
    method: init?.method || 'GET',
    headers,
    data: init?.body ?? undefined,
    responseType: 'text',
    connectTimeout: 10_000,
    readTimeout: 15_000,
  });
  init?.signal?.throwIfAborted();
  const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? null);
  return new Response(res.status === 204 ? null : body, {
    status: res.status,
    headers: res.headers as Record<string, string>,
  });
}
