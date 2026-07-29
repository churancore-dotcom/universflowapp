import { createFileRoute } from "@tanstack/react-router";
import ArtistActivity from "@/pages/artist/Activity";

export const Route = createFileRoute("/artist/studio/activity")({ component: ArtistActivity });
