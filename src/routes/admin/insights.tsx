import { createFileRoute } from "@tanstack/react-router";
import LiveInsights from "@/pages/admin/LiveInsights";

export const Route = createFileRoute("/admin/insights")({ component: LiveInsights });
