import { createFileRoute } from "@tanstack/react-router";
import Offline from "@/pages/Offline";
import { routeSeo } from "@/lib/routeSeo";

// Deliberately NOT auth-gated: this screen exists for the case where the
// device has no usable connection, and /auth cannot complete without one.
export const Route = createFileRoute("/offline")({
  head: () => routeSeo({
    title: "Offline Music — Universflow",
    description: "Listen to music saved on this device while you are offline.",
    path: "/offline",
  }),
  component: Offline,
});
