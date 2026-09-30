import { createFileRoute } from "@tanstack/react-router";
import LegalArtistTerms from "@/pages/legal/ArtistTerms";
import { routeSeo } from "@/lib/routeSeo";

export const Route = createFileRoute("/legal/artist-terms")({
  head: () => routeSeo({ title: "Artist Terms — Universflow", description: "Terms for artists on Universflow: uploading music, ownership, verification, payouts and takedowns.", path: "/legal/artist-terms" }),
  component: LegalArtistTerms,
});
