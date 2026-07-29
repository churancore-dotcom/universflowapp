import { createFileRoute } from "@tanstack/react-router";
import ManageSubscription from "@/pages/ManageSubscription";
import { ListenerRoute } from "@/lib/route-guards";

export const Route = createFileRoute("/subscription")({
  component: () => (
    <ListenerRoute>
      <ManageSubscription />
    </ListenerRoute>
  ),
});
