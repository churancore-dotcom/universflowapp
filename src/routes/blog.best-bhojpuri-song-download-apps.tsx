import { createFileRoute } from "@tanstack/react-router";
import BlogBhojpuriSongDownload from "@/pages/BlogBhojpuriSongDownload";
import { routeSeo } from "@/lib/routeSeo";

export const Route = createFileRoute("/blog/best-bhojpuri-song-download-apps")({
  head: () =>
    routeSeo({
      title: "Best Bhojpuri Song Download Apps (2026)",
      description:
        "Compare the best apps for Bhojpuri song downloads in 2026, including offline playback, audio quality and free listening options.",
      path: "/blog/best-bhojpuri-song-download-apps",
      type: "article",
    }),
  component: BlogBhojpuriSongDownload,
});
