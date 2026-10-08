import { createFileRoute } from "@tanstack/react-router";
import OfflinePlayerShell from "@/components/OfflinePlayerShell";
import { routeSeo } from "@/lib/routeSeo";

export const Route = createFileRoute("/offline-player")({
  component: OfflinePlayerShell,
  head: () => routeSeo({
    title: "Your Offline Songs — Univers Flow",
    description: "Listen to your downloaded Univers Flow songs without an internet connection.",
    path: "/offline-player",
  }),
});
