import { createFileRoute } from "@tanstack/react-router";
import RevenueInsights from "@/pages/admin/RevenueInsights";

export const Route = createFileRoute("/admin/revenue")({ component: RevenueInsights });
