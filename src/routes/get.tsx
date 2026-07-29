import { createFileRoute } from "@tanstack/react-router";
import { GetAppGate } from "@/lib/route-guards";

export const Route = createFileRoute("/get")({ component: GetAppGate });
