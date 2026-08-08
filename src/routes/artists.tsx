import { createFileRoute } from "@tanstack/react-router";
import AllArtists from "@/pages/AllArtists";
import { ListenerRoute } from "@/lib/route-guards";
import { routeSeo } from "@/lib/routeSeo";

export const Route = createFileRoute("/artists")({
  head: () =>
    routeSeo({
      title: "Browse Artists on Universflow",
      description:
        "Explore trending and verified artists on Universflow. Follow your favourites, listen to their top songs and discover new music free.",
      path: "/artists",
    }),
  component: () => (
    <ListenerRoute>
      <AllArtists />
    </ListenerRoute>
  ),
});
