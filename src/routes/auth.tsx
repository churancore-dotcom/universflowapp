import { createFileRoute } from "@tanstack/react-router";
import { Navigate } from "@/lib/router-compat";
import { useAuth } from "@/contexts/AuthContext";
import Auth from "@/pages/Auth";
import { routeSeo } from "@/lib/routeSeo";

function AuthPage() {
  const { user } = useAuth();
  return user ? <Navigate to="/" replace /> : <Auth />;
}

export const Route = createFileRoute("/auth")({
  head: () =>
    routeSeo({
      title: "Log in or Sign up — Universflow",
      description:
        "Sign in to Universflow to stream free music, sync your playlists and liked songs, and download tracks for offline listening.",
      path: "/auth",
    }),
  component: AuthPage,
});
