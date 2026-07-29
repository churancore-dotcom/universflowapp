import { createFileRoute } from "@tanstack/react-router";
import PlaylistDetail from "@/pages/PlaylistDetail";
import { ListenerRoute } from "@/lib/route-guards";

export const Route = createFileRoute("/playlist/$id")({
  component: () => (
    <ListenerRoute>
      <PlaylistDetail />
    </ListenerRoute>
  ),
});
