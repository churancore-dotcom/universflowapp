import { useEffect, useState, Suspense, lazy } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
  useRouter,
} from "@tanstack/react-router";

import appCss from "../styles.css?url";
import { reportLovableError } from "@/lib/lovable-error-reporting";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { PlayerProvider, usePlayer } from "@/contexts/PlayerContext";
import { DownloadProvider } from "@/contexts/DownloadContext";
import { NavDirectionProvider } from "@/components/PageTransition";
import { SentryErrorBoundary } from "@/components/SentryErrorBoundary";
import SplashScreen from "@/components/SplashScreen";
import MobileShell from "@/components/MobileShell";
import { usePushRegistration } from "@/hooks/usePushRegistration";
import { usePlaybackSync } from "@/hooks/usePlaybackSync";
import { usePremium } from "@/hooks/usePremium";
import { useUserEQSettingsSync } from "@/lib/eqSettings";
import { useAutoEQ } from "@/hooks/useAutoEQ";
import NotFound from "@/pages/NotFound";
import PrerollAd from "@/components/ads/PrerollAd";
import LiquidGlassFilters from "@/components/LiquidGlassFilters";


// Lazy load non-critical components
const RateUsPopup = lazy(() => import("@/components/RateUsPopup"));
const ReviewModal = lazy(() => import("@/components/ReviewModal"));
const GlobalPlayerLayer = lazy(() => import("@/components/GlobalPlayerLayer"));
const AnnouncementBanner = lazy(() => import("@/components/AnnouncementBanner"));
const OfflineGate = lazy(() => import("@/components/OfflineGate"));
const Toaster = lazy(() => import("@/components/ui/sonner").then(m => ({ default: m.Toaster })));
const DownloadQueuePanel = lazy(() => import("@/components/DownloadQueuePanel"));
const PWAInstallBanner = lazy(() => import("@/components/PWAInstallBanner"));

// Module-scope side effects must be idempotent: this module can be evaluated
// more than once (HMR, and the client/SSR graphs both pulling it in), and a
// second pass re-ran every boot import — that is what double-initialised Sentry
// Session Replay.
declare global {
  interface Window { __ufBooted?: boolean }
}

if (typeof window !== "undefined" && !window.__ufBooted) {
  window.__ufBooted = true;
  void import("@/lib/themeBoot");
  void import("@/lib/median");
  void import("@/lib/sentry").then((m) => m.initSentry());
  void import("@/lib/capacitorBoot").then((m) => m.initCapacitorNative());
  void import("@/lib/userPrefs").then((m) => m.applyLanguageToDocument());
  void import("@/hooks/useHaptics").then((m) => m.getHapticsEnabled());
  void import("@/lib/buildInfo").then(({ BUILD_INFO }) => {
    document.documentElement.dataset.appVersion = BUILD_INFO.version;
    document.documentElement.dataset.appRefresh = BUILD_INFO.refreshedAt;
  });
}

const GA_SNIPPET =
  "window.dataLayer = window.dataLayer || [];function gtag(){dataLayer.push(arguments);}gtag('js', new Date());gtag('config', 'G-KP0P1145TP');";

const SCHEMA_GRAPH = JSON.stringify({
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "WebSite", "@id": "https://universflow.in/#website", url: "https://universflow.in/", name: "Universflow", description: "Free music streaming and download — stream, follow artists, listen offline.", potentialAction: { "@type": "SearchAction", target: "https://universflow.in/search?q={search_term_string}", "query-input": "required name=search_term_string" } },
    { "@type": "Organization", "@id": "https://universflow.in/#org", name: "Universflow", url: "https://universflow.in/", logo: "https://universflow.in/pwa-512x512.png" },
  ],
});


export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes, viewport-fit=cover" },
      { title: "Universflow — Free Music Streaming App" },
      { name: "google-site-verification", content: "9i6sSAmlmRyKCJS2U4vNTHoKzSLvG4qx7bViokCa7Ik" },
      { name: "title", content: "Universflow — Free Music Streaming App" },
      { name: "description", content: "Universflow is a free music streaming app: play millions of songs, follow artists and download tracks for offline listening." },
      { name: "keywords", content: "free music app, music app, song app, song download app, mp3 song download app, mp3 download app, mp3 music download app, music download app, music player, free music download, free music apps, online music app, music streaming app, offline music app, music app for Android, free music app for Android, gana wala apps, mp3 gana, hindi songs app, punjabi songs app, bollywood music app, spotify alternative, jiosaavn alternative, gaana alternative, wynk alternative, snaptube alternative, Universflow, Universflow APK, Universflow download, Universflow Android app" },
      { name: "author", content: "Universflow Team" },
      { name: "creator", content: "Universflow Team" },
      { name: "publisher", content: "Univers Flow" },
      { name: "robots", content: "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" },
      { name: "googlebot", content: "index, follow" },
      { name: "bingbot", content: "index, follow" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "format-detection", content: "telephone=no" },
      { name: "HandheldFriendly", content: "true" },
      { name: "MobileOptimized", content: "width" },
      { name: "application-name", content: "Univers Flow" },
      { name: "apple-mobile-web-app-title", content: "Univers Flow" },
      { name: "theme-color", content: "#000000" },
      { name: "msapplication-navbutton-color", content: "#000000" },
      { name: "msapplication-TileColor", content: "#000000" },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Universflow" },
      { property: "og:locale", content: "en_US" },
      { property: "og:locale:alternate", content: "hi_IN" },
      // og:title / og:description / og:url are defined per-route (see leaf head()).

      { property: "og:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/s8DT7gYYLcVOTZXqNcZ7CA0DHkg2/social-images/social-1778415482112-Screenshot_2026-05-08_185337-modified.webp" },
      { property: "og:image:secure_url", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/s8DT7gYYLcVOTZXqNcZ7CA0DHkg2/social-images/social-1778415482112-Screenshot_2026-05-08_185337-modified.webp" },
      { property: "og:image:type", content: "image/webp" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: "Universflow — Free music streaming and download app for Android" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: "@UniversFlow" },
      { name: "twitter:creator", content: "@UniversFlow" },
      { name: "twitter:domain", content: "universflow.in" },
      // twitter:url / twitter:title / twitter:description are defined per-route.

      { name: "twitter:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/s8DT7gYYLcVOTZXqNcZ7CA0DHkg2/social-images/social-1778415482112-Screenshot_2026-05-08_185337-modified.webp" },
      { name: "twitter:image:alt", content: "Universflow — Free music streaming and download app for Android" },
      { name: "twitter:app:name:googleplay", content: "Universflow" },
      { name: "twitter:app:url:googleplay", content: "https://universflow.in/get" },
      { name: "pinterest-rich-pin", content: "true" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.json" },
      { rel: "apple-touch-icon", href: "/pwa-192x192.png" },
      { rel: "icon", type: "image/x-icon", href: "/favicon.ico" },
      { rel: "icon", type: "image/png", sizes: "192x192", href: "/pwa-192x192.png" },
      { rel: "icon", type: "image/png", sizes: "512x512", href: "/pwa-512x512.png" },
      { rel: "shortcut icon", href: "/favicon.ico" },
      { rel: "preconnect", href: "https://storage.googleapis.com" },
      { rel: "dns-prefetch", href: "https://storage.googleapis.com" },
      { rel: "preconnect", href: "https://kzaeahjeqlihmxrfhjqd.supabase.co" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow:wght@400;500;600;700;800;900&display=swap" },
      { rel: "preload", as: "image", href: "/app-logo.webp", type: "image/webp", fetchPriority: "high" },
    ],
    scripts: [
      { src: "https://www.googletagmanager.com/gtag/js?id=G-KP0P1145TP", async: true },
      { children: GA_SNIPPET },
      { type: "application/ld+json", children: SCHEMA_GRAPH },
      // FAQPage + app-install schemas live on the routes they describe (/ and /get).
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFound,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body suppressHydrationWarning>
        <LiquidGlassFilters />
        {children}
        <Scripts />
      </body>

    </html>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);
  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-background text-foreground px-6 text-center">
      <h1 className="text-lg font-semibold mb-2">This page didn't load</h1>
      <p className="text-sm text-muted-foreground mb-6 max-w-xs">
        Something went wrong while loading this page.
      </p>
      <div className="flex gap-3">
        <button
          onClick={() => { router.invalidate(); reset(); }}
          className="bg-primary text-primary-foreground rounded-full px-6 py-2.5 text-sm font-semibold"
        >
          Try again
        </button>
        <a href="/" className="rounded-full px-6 py-2.5 text-sm font-semibold border border-border">
          Go home
        </a>
      </div>
    </div>
  );
}

const PrerollAdWrapper = () => {
  const { showPrerollAd, onPrerollAdComplete, adType } = usePlayer();
  return (
    <PrerollAd
      isOpen={showPrerollAd}
      onComplete={onPrerollAdComplete}
      onSkip={onPrerollAdComplete}
      adType={adType}
    />
  );
};

const PostAuthGate = () => {
  const { user } = useAuth();
  const [showReview, setShowReview] = useState(false);

  if (!user) return null;
  return (
    <Suspense fallback={null}>
      <RateUsPopup onOpenReview={() => setShowReview(true)} />
      <ReviewModal isOpen={showReview} onClose={() => setShowReview(false)} />
    </Suspense>
  );
};

const LazyFallback = () => <div className="min-h-dvh bg-background" />;

const AppContent = () => {
  const [showSplash, setShowSplash] = useState(true);
  const { user } = useAuth();
  usePushRegistration();
  usePlaybackSync();
  useUserEQSettingsSync(user?.id);
  useAutoEQ();

  const handleSplashComplete = () => setShowSplash(false);

  return (
    <MobileShell>
      <Suspense fallback={null}>
        <Toaster />
      </Suspense>
      <NavDirectionProvider>
        <Suspense fallback={null}>
          <OfflineGate />
        </Suspense>
        <Suspense fallback={<LazyFallback />}>
          <div id="main-content" style={{ display: 'contents' }}>
            <Outlet />
          </div>
        </Suspense>
      </NavDirectionProvider>
      {/* Visual cover only — never interactive, and unmounted (not just faded)
          so it can't linger over the UI and swallow taps. */}
      {showSplash && <SplashScreen key="splash" onComplete={handleSplashComplete} />}


      <div className="fixed inset-x-3 top-[calc(env(safe-area-inset-top)+10px)] z-[60] pointer-events-none">
        <div className="mx-auto max-w-md pointer-events-auto">
          <Suspense fallback={null}>
            <AnnouncementBanner />
          </Suspense>
        </div>
      </div>
      <PrerollAdWrapper />
      <Suspense fallback={null}>
        <GlobalPlayerLayer />
      </Suspense>

      <PostAuthGate />
      <Suspense fallback={null}>
        <DownloadQueuePanel />
        <PWAInstallBanner />
      </Suspense>
    </MobileShell>
  );
};

const PremiumRuntimeSync = ({ children }: { children: React.ReactNode }) => {
  usePremium();
  return <>{children}</>;
};

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <SentryErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <PremiumRuntimeSync>
            <PlayerProvider>
              <DownloadProvider>
                <TooltipProvider>
                  <AppContent />
                </TooltipProvider>
              </DownloadProvider>
            </PlayerProvider>
          </PremiumRuntimeSync>
        </AuthProvider>
      </QueryClientProvider>
    </SentryErrorBoundary>
  );
}
