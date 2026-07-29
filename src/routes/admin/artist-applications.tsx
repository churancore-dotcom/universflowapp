import { createFileRoute } from "@tanstack/react-router";
import ArtistApplications from "@/pages/admin/ArtistApplications";

export const Route = createFileRoute("/admin/artist-applications")({ component: ArtistApplications });
