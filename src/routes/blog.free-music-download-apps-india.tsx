import { createFileRoute } from "@tanstack/react-router";
import BlogFreeMusicDownloadAppsIndia from "@/pages/BlogFreeMusicDownloadAppsIndia";
import { routeSeo } from "@/lib/routeSeo";

export const Route = createFileRoute("/blog/free-music-download-apps-india")({
  head: () =>
    routeSeo({
      title: "Best Free Music Download Apps in India (2026)",
      description:
        "A practical look at the best free music download apps in India for 2026 — offline support, audio quality, data use and pricing.",
      path: "/blog/free-music-download-apps-india",
      type: "article",
    }),
  component: BlogFreeMusicDownloadAppsIndia,
});
