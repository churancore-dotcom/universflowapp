import { createFileRoute } from "@tanstack/react-router";
import ArtistApply from "@/pages/artist/Apply";
import { ArtistProtectedRoute } from "@/lib/route-guards";
import { routeSeo } from "@/lib/routeSeo";

export const Route = createFileRoute("/artist/apply")({
  head: () =>
    routeSeo({
      title: "Apply as an Artist — Universflow",
      description: "Apply for a verified Universflow artist profile and manage your music, audience, and releases.",
      path: "/artist/apply",
    }),
  component: () => (
    <ArtistProtectedRoute>
      <ArtistApply />
    </ArtistProtectedRoute>
  ),
});
