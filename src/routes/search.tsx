import { createFileRoute } from "@tanstack/react-router";
import Search from "@/pages/Search";
import { ListenerRoute } from "@/lib/route-guards";

export const Route = createFileRoute("/search")({
  component: () => (
    <ListenerRoute>
      <Search />
    </ListenerRoute>
  ),
});
