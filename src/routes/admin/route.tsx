import { createFileRoute } from "@tanstack/react-router";
import AdminLayout from "@/pages/admin/AdminLayout";
import { AdminRoute } from "@/lib/route-guards";

export const Route = createFileRoute("/admin")({
  component: () => (
    <AdminRoute>
      <AdminLayout />
    </AdminRoute>
  ),
});
