import { createFileRoute } from "@tanstack/react-router";
import { Navigate } from "@/lib/router-compat";
import { useAuth } from "@/contexts/AuthContext";
import ArtistAuth from "@/pages/artist/ArtistAuth";

function ArtistAuthPage() {
  const { user } = useAuth();
  return user ? <Navigate to="/" replace /> : <ArtistAuth />;
}

export const Route = createFileRoute("/artist/auth")({ component: ArtistAuthPage });
