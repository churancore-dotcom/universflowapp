import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { ListenerRoute, LazyFallback } from "@/lib/route-guards";

const SearchPage = lazy(() => import("@/pages/Search"));

export const Route = createFileRoute("/search")({
  component: () => (
    <ListenerRoute>
      <Suspense fallback={<LazyFallback />}>
        <SearchPage />
      </Suspense>
    </ListenerRoute>
  ),
});
