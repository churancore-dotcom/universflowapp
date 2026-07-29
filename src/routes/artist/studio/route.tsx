import { createFileRoute } from "@tanstack/react-router";
import ArtistLayout from "@/pages/artist/ArtistLayout";
import { ArtistProtectedRoute } from "@/lib/route-guards";

export const Route = createFileRoute("/artist/studio")({
  component: () => (
    <ArtistProtectedRoute requireArtistRole>
      <ArtistLayout />
    </ArtistProtectedRoute>
  ),
});
