import { createFileRoute } from "@tanstack/react-router";
import AppUpdates from "@/pages/admin/AppUpdates";

export const Route = createFileRoute("/admin/app-updates")({ component: AppUpdates });
