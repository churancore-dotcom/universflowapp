import { createFileRoute } from "@tanstack/react-router";
import ManageSubscription from "@/pages/ManageSubscription";
import { ListenerRoute } from "@/lib/route-guards";
import { routeSeo } from "@/lib/routeSeo";

export const Route = createFileRoute("/subscription")({
  head: () => ({
    ...routeSeo({
      title: "Manage Subscription — Universflow",
      description: "Review and manage your Universflow subscription.",
      path: "/subscription",
    }),
    meta: [
      ...routeSeo({
        title: "Manage Subscription — Universflow",
        description: "Review and manage your Universflow subscription.",
        path: "/subscription",
      }).meta,
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: () => (
    <ListenerRoute>
      <ManageSubscription />
    </ListenerRoute>
  ),
});
