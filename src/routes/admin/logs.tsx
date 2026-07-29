import { createFileRoute } from "@tanstack/react-router";
import ActivityLogs from "@/pages/admin/ActivityLogs";

export const Route = createFileRoute("/admin/logs")({ component: ActivityLogs });
