import { createFileRoute } from "@tanstack/react-router";
import Downloads from "@/pages/Downloads";
import { ListenerRoute } from "@/lib/route-guards";

export const Route = createFileRoute("/downloads")({
  component: () => (
    <ListenerRoute>
      <Downloads />
    </ListenerRoute>
  ),
});
