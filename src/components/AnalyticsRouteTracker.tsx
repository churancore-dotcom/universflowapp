import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { trackPageView } from "@/lib/analytics";

/**
 * Fires a GA4 `page_view` event whenever the SPA route changes.
 * Mounted once inside <BrowserRouter>. Skips the very first render because
 * gtag.js already sends the initial page_view via its `config` call in
 * index.html — avoids a duplicate hit on cold load.
 */
export default function AnalyticsRouteTracker() {
  const location = useLocation();

  useEffect(() => {
    // Defer to next tick so document.title (set by SEOHead) is up-to-date.
    const id = window.setTimeout(() => {
      trackPageView(location.pathname + location.search, document.title);
    }, 0);
    return () => window.clearTimeout(id);
  }, [location.pathname, location.search]);

  return null;
}
