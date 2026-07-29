import { createFileRoute } from "@tanstack/react-router";
import PaymentRequests from "@/pages/admin/PaymentRequests";

export const Route = createFileRoute("/admin/payments")({ component: PaymentRequests });
