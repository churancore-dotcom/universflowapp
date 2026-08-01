import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { ListenerRoute, LazyFallback } from "@/lib/route-guards";

const LibraryPage = lazy(() => import("@/pages/Library"));

export const Route = createFileRoute("/library")({
  component: () => (
    <ListenerRoute>
      <Suspense fallback={<LazyFallback />}>
        <LibraryPage />
      </Suspense>
    </ListenerRoute>
  ),
});
