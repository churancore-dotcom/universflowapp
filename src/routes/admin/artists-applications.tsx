import { createFileRoute } from "@tanstack/react-router";
import { Navigate } from "@/lib/router-compat";

export const Route = createFileRoute("/admin/artists-applications")({
  component: () => <Navigate to="/admin/artist-applications" replace />,
});
