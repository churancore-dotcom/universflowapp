import { createFileRoute } from "@tanstack/react-router";
import Offline from "@/pages/Offline";
import { ListenerRoute } from "@/lib/route-guards";

export const Route = createFileRoute("/offline")({
  component: () => (
    <ListenerRoute>
      <Offline />
    </ListenerRoute>
  ),
});
