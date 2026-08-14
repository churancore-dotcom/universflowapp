import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { ProtectedRoute, LazyFallback } from "@/lib/route-guards";
import { routeSeo } from "@/lib/routeSeo";

const SettingsPage = lazy(() => import("@/pages/Settings"));

export const Route = createFileRoute("/settings")({
  head: () => {
    const seo = routeSeo({
      title: "Account Settings — Universflow",
      description:
        "Manage your Universflow account: audio quality, equalizer, themes, downloads, notifications and privacy preferences.",
      path: "/settings",
    });
    return { ...seo, meta: [...seo.meta, { name: "robots", content: "noindex, follow" }] };
  },
  component: () => (
    <ProtectedRoute>
      <Suspense fallback={<LazyFallback />}>
        <SettingsPage />
      </Suspense>
    </ProtectedRoute>
  ),
});
