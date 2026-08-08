import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { ListenerRoute, LazyFallback } from "@/lib/route-guards";
import { routeSeo } from "@/lib/routeSeo";

const SearchPage = lazy(() => import("@/pages/Search"));

export const Route = createFileRoute("/search")({
  head: () =>
    routeSeo({
      title: "Search Songs & Artists — Universflow",
      description:
        "Search millions of songs, albums and artists on Universflow. Play instantly, add to playlists or download tracks for offline listening.",
      path: "/search",
    }),
  component: () => (
    <ListenerRoute>
      <Suspense fallback={<LazyFallback />}>
        <SearchPage />
      </Suspense>
    </ListenerRoute>
  ),
});
