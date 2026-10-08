import { createFileRoute } from "@tanstack/react-router";
import OfflinePlayerShell from "@/components/OfflinePlayerShell";
import { routeSeo } from "@/lib/routeSeo";

export const Route = createFileRoute("/offline-player")({
  component: OfflinePlayerShell,
  head: () => {
    const seo = routeSeo({
      title: "Your Offline Songs — Univers Flow",
      description: "Listen to your downloaded Univers Flow songs without an internet connection.",
      path: "/offline-player",
    });
    return { ...seo, meta: seo.meta.filter(tag => !(('property' in tag && tag.property === 'og:image') || ('name' in tag && tag.name === 'twitter:image'))) };
  },
});
