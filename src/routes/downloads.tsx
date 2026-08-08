import { createFileRoute } from "@tanstack/react-router";
import Downloads from "@/pages/Downloads";
import { ListenerRoute } from "@/lib/route-guards";
import { routeSeo } from "@/lib/routeSeo";

export const Route = createFileRoute("/downloads")({
  head: () =>
    routeSeo({
      title: "Offline Downloads — Universflow",
      description:
        "Manage the songs you saved for offline playback on Universflow and listen anywhere without using mobile data.",
      path: "/downloads",
    }),
  component: () => (
    <ListenerRoute>
      <Downloads />
    </ListenerRoute>
  ),
});
