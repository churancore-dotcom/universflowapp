import { createFileRoute } from "@tanstack/react-router";
import ArtistDetail from "@/pages/ArtistDetail";
import { ProtectedRoute } from "@/lib/route-guards";

export const Route = createFileRoute("/artist/$artistId")({
  component: () => (
    <ProtectedRoute>
      <ArtistDetail />
    </ProtectedRoute>
  ),
});
