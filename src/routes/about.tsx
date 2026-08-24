import { createFileRoute } from "@tanstack/react-router";
import About from "@/pages/About";
import { routeSeo } from "@/lib/routeSeo";

export const Route = createFileRoute("/about")({
  head: () =>
    routeSeo({
      title: "About Universflow — Free Music Streaming & Offline Downloads",
      description:
        "What Universflow is, why we built it, how personalized feeds work, what Premium unlocks, and how to reach the team behind the free music app.",
      path: "/about",
    }),
  component: About,
});
