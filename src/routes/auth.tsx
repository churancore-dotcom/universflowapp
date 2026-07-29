import { createFileRoute } from "@tanstack/react-router";
import { Navigate } from "@/lib/router-compat";
import { useAuth } from "@/contexts/AuthContext";
import Auth from "@/pages/Auth";

function AuthPage() {
  const { user } = useAuth();
  return user ? <Navigate to="/" replace /> : <Auth />;
}

export const Route = createFileRoute("/auth")({ component: AuthPage });
