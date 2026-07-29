import { createFileRoute } from "@tanstack/react-router";
import ArtistTeamManagement from "@/pages/artist/TeamManagement";

export const Route = createFileRoute("/artist/studio/team")({ component: ArtistTeamManagement });
