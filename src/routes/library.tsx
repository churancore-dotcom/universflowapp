import { createFileRoute } from "@tanstack/react-router";
import Library from "@/pages/Library";
import { ListenerRoute } from "@/lib/route-guards";

export const Route = createFileRoute("/library")({
  component: () => (
    <ListenerRoute>
      <Library />
    </ListenerRoute>
  ),
});
