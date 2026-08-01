import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { ProtectedRoute, LazyFallback } from "@/lib/route-guards";

const PlaylistDetailPage = lazy(() => import("@/pages/PlaylistDetail"));

export const Route = createFileRoute("/playlist/$id")({
  component: () => (
    <ProtectedRoute>
      <Suspense fallback={<LazyFallback />}>
        <PlaylistDetailPage />
      </Suspense>
    </ProtectedRoute>
  ),
});
