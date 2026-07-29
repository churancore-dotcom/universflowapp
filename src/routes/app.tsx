import { createFileRoute } from "@tanstack/react-router";
import { Navigate } from "@/lib/router-compat";

export const Route = createFileRoute("/app")({
  component: () => <Navigate to="/get" replace />,
});
