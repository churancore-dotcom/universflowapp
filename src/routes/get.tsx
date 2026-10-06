import { createFileRoute } from "@tanstack/react-router";
import { GetAppGate } from "@/lib/route-guards";
import { routeSeo, APP_SCHEMA } from "@/lib/routeSeo";

export const Route = createFileRoute("/get")({
  component: GetAppGate,
  head: () => {
    const seo = routeSeo({
      title: "Download Universflow APK — Free Music App for Android",
      description:
        "Download the latest available Universflow Android APK. Free music streaming, offline downloads, equalizer and background playback.",
      path: "/get",
    });
    return {
      ...seo,
      scripts: [{ type: "application/ld+json", children: APP_SCHEMA }],
    };
  },
});
