import { createFileRoute } from "@tanstack/react-router";
import ArtistOverview from "@/pages/artist/Overview";

export const Route = createFileRoute("/artist/studio/")({ component: ArtistOverview });
