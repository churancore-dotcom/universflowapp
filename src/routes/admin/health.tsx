import { createFileRoute } from "@tanstack/react-router";
import SystemHealth from "@/pages/admin/SystemHealth";

export const Route = createFileRoute("/admin/health")({ component: SystemHealth });
