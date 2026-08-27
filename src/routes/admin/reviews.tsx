import { createFileRoute } from "@tanstack/react-router";
import AdminReviews from "@/pages/admin/Reviews";

export const Route = createFileRoute("/admin/reviews")({ component: AdminReviews });
