import { createFileRoute } from "@tanstack/react-router";
import PushNotifications from "@/pages/admin/PushNotifications";

export const Route = createFileRoute("/admin/notifications")({ component: PushNotifications });
