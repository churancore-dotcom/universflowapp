import { createFileRoute } from "@tanstack/react-router";
import ArtistStatus from "@/pages/artist/Status";
import { ArtistProtectedRoute } from "@/lib/route-guards";

export const Route = createFileRoute("/artist/status")({
  component: () => (
    <ArtistProtectedRoute>
      <ArtistStatus />
    </ArtistProtectedRoute>
  ),
});
