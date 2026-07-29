import { createFileRoute } from "@tanstack/react-router";
import PerformancePanel from "@/pages/admin/PerformancePanel";

export const Route = createFileRoute("/admin/performance")({ component: PerformancePanel });
