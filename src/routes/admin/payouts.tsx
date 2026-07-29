import { createFileRoute } from "@tanstack/react-router";
import AdminPayouts from "@/pages/admin/Payouts";

export const Route = createFileRoute("/admin/payouts")({ component: AdminPayouts });
