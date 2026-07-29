import { createFileRoute } from "@tanstack/react-router";
import Analytics from "@/pages/admin/Analytics";

export const Route = createFileRoute("/admin/analytics")({ component: Analytics });
