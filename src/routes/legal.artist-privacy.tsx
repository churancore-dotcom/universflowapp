import { createFileRoute } from "@tanstack/react-router";
import LegalArtistPrivacy from "@/pages/legal/ArtistPrivacy";
import { routeSeo } from "@/lib/routeSeo";

export const Route = createFileRoute("/legal/artist-privacy")({
  head: () => routeSeo({ title: "Artist Privacy Policy — Universflow", description: "How Universflow handles artist verification details, uploaded music and profile data for creators.", path: "/legal/artist-privacy" }),
  component: LegalArtistPrivacy,
});
