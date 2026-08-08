import { createFileRoute } from "@tanstack/react-router";
import Support from "@/pages/Support";
import { routeSeo } from "@/lib/routeSeo";

export const Route = createFileRoute("/support")({
  head: () =>
    routeSeo({
      title: "Help & Support — Universflow",
      description:
        "Get help with Universflow playback, downloads, accounts and Premium billing, or contact the team with your question.",
      path: "/support",
    }),
  component: Support,
});
