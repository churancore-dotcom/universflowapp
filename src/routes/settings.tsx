import { createFileRoute } from "@tanstack/react-router";
import Settings from "@/pages/Settings";
import { ListenerRoute } from "@/lib/route-guards";

export const Route = createFileRoute("/settings")({
  component: () => (
    <ListenerRoute>
      <Settings />
    </ListenerRoute>
  ),
});
