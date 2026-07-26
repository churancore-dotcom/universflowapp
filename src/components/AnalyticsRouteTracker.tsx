import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { trackPageView, setAnalyticsUser } from "@/lib/analytics";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Fires a GA4 `page_view` event on every SPA route change, and attaches the
 * signed-in user's ID so GA4 can attribute engagement across sessions.
 * Mounted once inside <BrowserRouter>.
 */
export default function AnalyticsRouteTracker() {
  const location = useLocation();
  const { user } = useAuth();

  useEffect(() => {
    setAnalyticsUser(user?.id ?? null);
  }, [user?.id]);

  useEffect(() => {
    // Defer to next tick so document.title (set by SEOHead) is up-to-date.
    const id = window.setTimeout(() => {
      trackPageView(location.pathname + location.search, document.title);
    }, 0);
    return () => window.clearTimeout(id);
  }, [location.pathname, location.search]);

  return null;
}
