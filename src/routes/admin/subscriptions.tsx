import { createFileRoute } from "@tanstack/react-router";
import ManageSubscriptions from "@/pages/admin/ManageSubscriptions";

export const Route = createFileRoute("/admin/subscriptions")({ component: ManageSubscriptions });
