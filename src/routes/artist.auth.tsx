import { createFileRoute } from "@tanstack/react-router";
import { Navigate } from "@/lib/router-compat";
import { useAuth } from "@/contexts/AuthContext";
import ArtistAuth from "@/pages/artist/ArtistAuth";
import { routeSeo } from "@/lib/routeSeo";

function ArtistAuthPage() {
  const { user } = useAuth();
  return user ? <Navigate to="/" replace /> : <ArtistAuth />;
}

export const Route = createFileRoute("/artist/auth")({
  head: () =>
    routeSeo({
      title: "Artist Sign In — Universflow",
      description: "Sign in to Universflow for Artists to manage your profile, releases, audience, and account.",
      path: "/artist/auth",
    }),
  component: ArtistAuthPage,
});
