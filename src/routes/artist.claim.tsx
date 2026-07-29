import { createFileRoute } from "@tanstack/react-router";
import ArtistClaimProfile from "@/pages/artist/ClaimProfile";
import { ArtistProtectedRoute } from "@/lib/route-guards";

export const Route = createFileRoute("/artist/claim")({
  component: () => (
    <ArtistProtectedRoute>
      <ArtistClaimProfile />
    </ArtistProtectedRoute>
  ),
});
