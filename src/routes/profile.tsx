import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { ProtectedRoute, LazyFallback } from "@/lib/route-guards";

const ProfilePage = lazy(() => import("@/pages/Profile"));

export const Route = createFileRoute("/profile")({
  component: () => (
    <ProtectedRoute>
      <Suspense fallback={<LazyFallback />}>
        <ProfilePage />
      </Suspense>
    </ProtectedRoute>
  ),
});
