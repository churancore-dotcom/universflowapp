import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { ProtectedRoute, LazyFallback } from "@/lib/route-guards";

const ArtistDetailPage = lazy(() => import("@/pages/ArtistDetail"));

export const Route = createFileRoute("/artist/$artistId")({
  component: () => (
    <ProtectedRoute>
      <Suspense fallback={<LazyFallback />}>
        <ArtistDetailPage />
      </Suspense>
    </ProtectedRoute>
  ),
});
