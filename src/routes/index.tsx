import { createFileRoute } from "@tanstack/react-router";
import { RootGate } from "@/lib/route-guards";
import { routeSeo, FAQ_SCHEMA } from "@/lib/routeSeo";

export const Route = createFileRoute("/")({
  component: RootGate,
  head: () => {
    const seo = routeSeo({
      title: "Universflow — Free Music Streaming & Offline Downloads",
      description:
        "Stream millions of songs free on Universflow. Build playlists, follow artists, download tracks and listen offline on Android or the web.",
      path: "/",
    });
    return {
      ...seo,
      scripts: [{ type: "application/ld+json", children: FAQ_SCHEMA }],
    };
  },
});
