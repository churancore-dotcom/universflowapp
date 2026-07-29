import { createFileRoute } from "@tanstack/react-router";
import { RootGate } from "@/lib/route-guards";

export const Route = createFileRoute("/")({ component: RootGate });
