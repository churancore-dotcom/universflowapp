import { createFileRoute } from "@tanstack/react-router";
import AllArtists from "@/pages/AllArtists";
import { ListenerRoute } from "@/lib/route-guards";

export const Route = createFileRoute("/artists")({
  component: () => (
    <ListenerRoute>
      <AllArtists />
    </ListenerRoute>
  ),
});
