import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { ProtectedRoute, LazyFallback } from "@/lib/route-guards";
import { SITE_ORIGIN, SOCIAL_IMAGE } from "@/lib/routeSeo";

const ArtistDetailPage = lazy(() => import("@/pages/ArtistDetail"));

export const Route = createFileRoute("/artist/$artistId")({
  head: ({ params }) => {
    const label = decodeURIComponent(params.artistId).replace(/[-_]+/g, " ").trim();
    const title = `${label} — Artist on Universflow`;
    const description = `Listen to ${label} on Universflow: top songs, albums and artist radio. Sign in to play the full catalogue free.`;
    const url = `${SITE_ORIGIN}/artist/${encodeURIComponent(params.artistId)}`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        // In-app artist view sits behind sign-in; the crawlable editorial
        // artist pages live at /a/$slug and /artists.
        { name: "robots", content: "noindex, follow" },
        { property: "og:type", content: "profile" },
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
        <ArtistDetailPage />
      </Suspense>
    </ProtectedRoute>
  ),
});
