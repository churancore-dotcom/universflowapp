import { createFileRoute } from "@tanstack/react-router";
import ArtistClaimProfile from "@/pages/artist/ClaimProfile";
import { ArtistProtectedRoute } from "@/lib/route-guards";
import { routeSeo } from "@/lib/routeSeo";

export const Route = createFileRoute("/artist/claim")({
  head: () =>
    routeSeo({
      title: "Claim Your Artist Profile — Universflow",
      description: "Claim and verify your Universflow artist profile to manage your public identity and music catalog.",
      path: "/artist/claim",
    }),
  component: () => (
    <ArtistProtectedRoute>
      <ArtistClaimProfile />
    </ArtistProtectedRoute>
  ),
});
