import { createFileRoute } from "@tanstack/react-router";
import AllArtists from "@/pages/AllArtists";
import { routeSeo } from "@/lib/routeSeo";

export const Route = createFileRoute("/artists")({
  head: () =>
    routeSeo({
      title: "Browse Artists on Universflow",
      description:
        "Explore trending and verified artists on Universflow. Follow your favourites, listen to their top songs and discover new music free.",
      path: "/artists",
    }),
  // Public: the artist directory is the crawlable entry point into the catalog,
  // so it must render for signed-out visitors and search/AI crawlers.
  component: AllArtists,
});
