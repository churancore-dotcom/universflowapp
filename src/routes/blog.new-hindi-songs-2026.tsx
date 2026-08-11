import { createFileRoute } from "@tanstack/react-router";
import BlogNewHindiSongs2026 from "@/pages/BlogNewHindiSongs2026";
import { routeSeo } from "@/lib/routeSeo";

export const Route = createFileRoute("/blog/new-hindi-songs-2026")({
  head: () =>
    routeSeo({
      title: "New Hindi Songs 2026 — Latest Bollywood Releases",
      description:
        "The newest Hindi and Bollywood songs of 2026, updated regularly. Listen free on Universflow or download them for offline playback.",
      path: "/blog/new-hindi-songs-2026",
      type: "article",
      datePublished: "2026-07-18",
    }),
  component: BlogNewHindiSongs2026,
});
