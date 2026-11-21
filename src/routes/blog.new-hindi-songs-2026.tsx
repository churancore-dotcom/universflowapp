import { createFileRoute } from "@tanstack/react-router";
import BlogNewHindiSongs2026 from "@/pages/BlogNewHindiSongs2026";
import { routeSeo } from "@/lib/routeSeo";

export const Route = createFileRoute("/blog/new-hindi-songs-2026")({
  head: () =>
    routeSeo({
      title: "Hindi Songs to Stream in 2026 — Popular Bollywood Hits",
      description:
        "Popular Hindi and Bollywood songs worth streaming, plus where to find this week's new releases in Universflow.",
      path: "/blog/new-hindi-songs-2026",
      type: "article",
      datePublished: "2026-07-18",
    }),
  component: BlogNewHindiSongs2026,
});
