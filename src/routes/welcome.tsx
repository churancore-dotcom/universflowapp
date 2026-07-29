import { createFileRoute } from "@tanstack/react-router";
import { Navigate } from "@/lib/router-compat";

export const Route = createFileRoute("/welcome")({
  component: () => <Navigate to="/auth" replace />,
});
