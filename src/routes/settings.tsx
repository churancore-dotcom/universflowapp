import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { ProtectedRoute, LazyFallback } from "@/lib/route-guards";

const SettingsPage = lazy(() => import("@/pages/Settings"));

export const Route = createFileRoute("/settings")({
  component: () => (
    <ProtectedRoute>
      <Suspense fallback={<LazyFallback />}>
        <SettingsPage />
      </Suspense>
    </ProtectedRoute>
  ),
});
