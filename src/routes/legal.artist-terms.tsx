import { createFileRoute } from "@tanstack/react-router";
import LegalArtistTerms from "@/pages/legal/ArtistTerms";

export const Route = createFileRoute("/legal/artist-terms")({ component: LegalArtistTerms });
