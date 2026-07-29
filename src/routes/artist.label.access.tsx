import { createFileRoute } from "@tanstack/react-router";
import ArtistLabelAccess from "@/pages/artist/LabelAccess";
import { ArtistProtectedRoute } from "@/lib/route-guards";

export const Route = createFileRoute("/artist/label/access")({
  component: () => (
    <ArtistProtectedRoute>
      <ArtistLabelAccess />
    </ArtistProtectedRoute>
  ),
});
