import { createFileRoute } from "@tanstack/react-router";
import BlogTrendingPunjabiSongs2026 from "@/pages/BlogTrendingPunjabiSongs2026";
import { routeSeo } from "@/lib/routeSeo";

export const Route = createFileRoute("/blog/trending-punjabi-songs-2026")({
  head: () =>
    routeSeo({
      title: "Popular Punjabi Songs to Stream in 2026",
      description:
        "Popular Punjabi songs and artists worth streaming, plus where to find the current official chart in Universflow.",
      path: "/blog/trending-punjabi-songs-2026",
      type: "article",
      datePublished: "2026-06-14",
    }),
  component: BlogTrendingPunjabiSongs2026,
});
