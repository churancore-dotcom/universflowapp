import { createFileRoute } from "@tanstack/react-router";
import Profile from "@/pages/Profile";
import { ListenerRoute } from "@/lib/route-guards";

export const Route = createFileRoute("/profile")({
  component: () => (
    <ListenerRoute>
      <Profile />
    </ListenerRoute>
  ),
});
