import { createFileRoute } from "@tanstack/react-router";
import ListenerInsights from "@/pages/admin/ListenerInsights";

export const Route = createFileRoute("/admin/listener-insights")({ component: ListenerInsights });
