import { createFileRoute } from "@tanstack/react-router";
import Premium from "@/pages/Premium";
import { routeSeo } from "@/lib/routeSeo";

export const Route = createFileRoute("/premium")({
  head: () =>
    routeSeo({
      title: "Universflow Premium — Ad-Free Music & Studio EQ",
      description:
        "Upgrade to Universflow Premium for ad-free listening, the 10-band studio equalizer, vocal and beat isolation and higher-quality audio.",
      path: "/premium",
    }),
  component: Premium,
});
