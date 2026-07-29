import { createFileRoute } from "@tanstack/react-router";
import LegalArtistPrivacy from "@/pages/legal/ArtistPrivacy";

export const Route = createFileRoute("/legal/artist-privacy")({ component: LegalArtistPrivacy });
