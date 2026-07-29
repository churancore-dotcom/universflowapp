import { createFileRoute } from "@tanstack/react-router";
import SecurityCenter from "@/pages/admin/SecurityCenter";

export const Route = createFileRoute("/admin/security")({ component: SecurityCenter });
