import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { ProtectedRoute, LazyFallback } from "@/lib/route-guards";
import { SITE_ORIGIN, SOCIAL_IMAGE } from "@/lib/routeSeo";

const PlaylistDetailPage = lazy(() => import("@/pages/PlaylistDetail"));

export const Route = createFileRoute("/playlist/$id")({
  head: ({ params }) => {
    const label = decodeURIComponent(params.id).replace(/[-_]+/g, " ").trim();
    const title = `${label} — Playlist on Universflow`;
    const description = `Play the ${label} playlist on Universflow: a hand-built mix you can stream free, download for offline and add to your library.`;
    const url = `${SITE_ORIGIN}/playlist/${encodeURIComponent(params.id)}`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        // Personal/library playlists are sign-in only, so keep them out of the index.
        { name: "robots", content: "noindex, follow" },
        { property: "og:type", content: "music.playlist" },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: url },
        { property: "og:image", content: SOCIAL_IMAGE },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        { name: "twitter:image", content: SOCIAL_IMAGE },
      ],
      links: [{ rel: "canonical", href: url }],
    };
  },
  component: () => (
    <ProtectedRoute>
      <Suspense fallback={<LazyFallback />}>
        <PlaylistDetailPage />
      </Suspense>
    </ProtectedRoute>
  ),
});
