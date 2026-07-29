import { createFileRoute } from "@tanstack/react-router";
import { Navigate } from "@/lib/router-compat";

export const Route = createFileRoute("/download")({
  component: () => <Navigate to="/get" replace />,
});
