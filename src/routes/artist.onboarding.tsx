import { createFileRoute } from "@tanstack/react-router";
import ArtistOnboarding from "@/pages/artist/AccessHub";
import { ArtistProtectedRoute } from "@/lib/route-guards";

export const Route = createFileRoute("/artist/onboarding")({
  component: () => (
    <ArtistProtectedRoute>
      <ArtistOnboarding />
    </ArtistProtectedRoute>
  ),
});
