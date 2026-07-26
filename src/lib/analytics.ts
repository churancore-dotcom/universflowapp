// GA4 helper. The gtag.js script + `gtag('config', 'G-KP0P1145TP')` are
// loaded in index.html. This file adds:
//  - SPA route tracking (send `page_view` on every in-app navigation)
//  - `trackEvent` for custom events (song play, download, follow, search, etc.)
//
// GA4's `send_page_view` is left at its default (true) for the initial load,
// then we manually fire `page_view` on route changes with `page_path` +
// `page_location` + `page_title` so every route shows up in GA4 reports.

const GA_MEASUREMENT_ID = "G-KP0P1145TP";

type GtagFn = (...args: unknown[]) => void;

function getGtag(): GtagFn | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { gtag?: GtagFn };
  return typeof w.gtag === "function" ? w.gtag : null;
}

// ---- Debug event bus (in-app Analytics Debug panel) ----
export type AnalyticsDebugEvent = {
  id: string;
  ts: number;
  name: string;
  params: Record<string, unknown>;
};

const DEBUG_BUFFER_MAX = 200;
const debugBuffer: AnalyticsDebugEvent[] = [];
const debugListeners = new Set<(e: AnalyticsDebugEvent) => void>();

function emitDebug(name: string, params: Record<string, unknown>) {
  const evt: AnalyticsDebugEvent = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: Date.now(),
    name,
    params,
  };
  debugBuffer.push(evt);
  if (debugBuffer.length > DEBUG_BUFFER_MAX) debugBuffer.shift();
  debugListeners.forEach((l) => {
    try { l(evt); } catch { /* ignore */ }
  });
}

export function getAnalyticsDebugBuffer(): AnalyticsDebugEvent[] {
  return debugBuffer.slice();
}

export function subscribeAnalyticsDebug(
  listener: (e: AnalyticsDebugEvent) => void,
): () => void {
  debugListeners.add(listener);
  return () => { debugListeners.delete(listener); };
}

export function clearAnalyticsDebugBuffer() {
  debugBuffer.length = 0;
}

export function trackPageView(path: string, title?: string) {
  const params = {
    page_path: path,
    page_location: typeof window !== "undefined" ? window.location.href : path,
    page_title: title ?? (typeof document !== "undefined" ? document.title : undefined),
    send_to: GA_MEASUREMENT_ID,
  };
  emitDebug("page_view", params);
  const gtag = getGtag();
  if (!gtag) return;
  gtag("event", "page_view", params);
}

export function trackEvent(
  name: string,
  params: Record<string, unknown> = {},
) {
  const merged = { send_to: GA_MEASUREMENT_ID, ...params };
  emitDebug(name, merged);
  const gtag = getGtag();
  if (!gtag) return;
  gtag("event", name, merged);
}

export function setAnalyticsUser(userId: string | null) {
  emitDebug("_set_user_id", { user_id: userId });
  const gtag = getGtag();
  if (!gtag) return;
  gtag("config", GA_MEASUREMENT_ID, {
    user_id: userId ?? undefined,
  });
}

