import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import ErrorBoundary from "./components/ErrorBoundary";

// Apply saved theme tokens BEFORE React mounts (prevents flash + ensures every page is themed)
import "@/lib/themeBoot";

// Initialize Median detection globals
import "@/lib/median";

// Initialize Sentry error monitoring (must run before React mounts)
import { initSentry } from "@/lib/sentry";
import { BUILD_INFO } from "@/lib/buildInfo";
import { initCapacitorNative } from "@/lib/capacitorBoot";
initSentry();
initCapacitorNative();

// Apply saved language + haptics preferences before first render.
import { applyLanguageToDocument } from "@/lib/userPrefs";
import { getHapticsEnabled } from "@/hooks/useHaptics";
applyLanguageToDocument();
getHapticsEnabled();


document.documentElement.dataset.appVersion = BUILD_INFO.version;
document.documentElement.dataset.appRefresh = BUILD_INFO.refreshedAt;

const rootElement = document.getElementById("root");

if (rootElement) {
  createRoot(rootElement).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}
