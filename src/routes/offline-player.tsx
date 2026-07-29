import { createFileRoute } from "@tanstack/react-router";
import OfflinePlayerShell from "@/components/OfflinePlayerShell";

export const Route = createFileRoute("/offline-player")({ component: OfflinePlayerShell });
