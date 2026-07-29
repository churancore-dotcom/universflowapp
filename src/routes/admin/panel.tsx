import { createFileRoute } from "@tanstack/react-router";
import AdminPanel from "@/pages/admin/AdminPanel";

export const Route = createFileRoute("/admin/panel")({ component: AdminPanel });
