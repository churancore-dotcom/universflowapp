import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { ListenerRoute, LazyFallback } from "@/lib/route-guards";
import { routeSeo } from "@/lib/routeSeo";

const LibraryPage = lazy(() => import("@/pages/Library"));

export const Route = createFileRoute("/library")({
  head: () =>
    routeSeo({
      title: "Your Library — Universflow",
      description:
        "All your liked songs, playlists and followed artists in one place. Keep your Universflow music library synced across devices.",
      path: "/library",
    }),
  component: () => (
    <ListenerRoute>
      <Suspense fallback={<LazyFallback />}>
        <LibraryPage />
      </Suspense>
    </ListenerRoute>
  ),
});
