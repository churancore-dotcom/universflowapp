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

export function trackPageView(path: string, title?: string) {
  const gtag = getGtag();
  if (!gtag) return;
  gtag("event", "page_view", {
    page_path: path,
    page_location: typeof window !== "undefined" ? window.location.href : path,
    page_title: title ?? (typeof document !== "undefined" ? document.title : undefined),
    send_to: GA_MEASUREMENT_ID,
  });
}

export function trackEvent(
  name: string,
  params: Record<string, unknown> = {},
) {
  const gtag = getGtag();
  if (!gtag) return;
  gtag("event", name, { send_to: GA_MEASUREMENT_ID, ...params });
}

export function setAnalyticsUser(userId: string | null) {
  const gtag = getGtag();
  if (!gtag) return;
  gtag("config", GA_MEASUREMENT_ID, {
    user_id: userId ?? undefined,
  });
}
