import { createFileRoute } from "@tanstack/react-router";
import BlogUniversflowVsJiosaavnVsGaana from "@/pages/BlogUniversflowVsJiosaavnVsGaana";
import { routeSeo } from "@/lib/routeSeo";

export const Route = createFileRoute("/blog/universflow-vs-jiosaavn-vs-gaana")({
  head: () =>
    routeSeo({
      title: "Universflow vs JioSaavn vs Gaana — 2026 Comparison",
      description:
        "How Universflow compares with JioSaavn and Gaana on free listening, offline downloads, audio quality, equalizer features and app size.",
      path: "/blog/universflow-vs-jiosaavn-vs-gaana",
      type: "article",
    }),
  component: BlogUniversflowVsJiosaavnVsGaana,
});
