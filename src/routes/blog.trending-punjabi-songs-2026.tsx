import { createFileRoute } from "@tanstack/react-router";
import BlogTrendingPunjabiSongs2026 from "@/pages/BlogTrendingPunjabiSongs2026";
import { routeSeo } from "@/lib/routeSeo";

export const Route = createFileRoute("/blog/trending-punjabi-songs-2026")({
  head: () =>
    routeSeo({
      title: "Trending Punjabi Songs 2026 — Top Tracks Right Now",
      description:
        "The Punjabi songs everyone is playing in 2026. Stream the trending list free on Universflow or save tracks for offline listening.",
      path: "/blog/trending-punjabi-songs-2026",
      type: "article",
      datePublished: "2026-06-14",
    }),
  component: BlogTrendingPunjabiSongs2026,
});
