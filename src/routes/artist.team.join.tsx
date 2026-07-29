import { createFileRoute } from "@tanstack/react-router";
import ArtistJoinTeam from "@/pages/artist/JoinTeam";
import { ArtistProtectedRoute } from "@/lib/route-guards";

export const Route = createFileRoute("/artist/team/join")({
  component: () => (
    <ArtistProtectedRoute>
      <ArtistJoinTeam />
    </ArtistProtectedRoute>
  ),
});
