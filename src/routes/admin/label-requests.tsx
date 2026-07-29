import { createFileRoute } from "@tanstack/react-router";
import AdminLabelRequests from "@/pages/admin/LabelRequests";

export const Route = createFileRoute("/admin/label-requests")({ component: AdminLabelRequests });
