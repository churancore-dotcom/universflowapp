import { createFileRoute } from "@tanstack/react-router";
import AdminArtistClaims from "@/pages/admin/ArtistClaims";

export const Route = createFileRoute("/admin/artist-claims")({ component: AdminArtistClaims });
