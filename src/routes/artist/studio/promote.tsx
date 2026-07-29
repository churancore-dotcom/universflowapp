import { createFileRoute } from "@tanstack/react-router";
import ArtistPromote from "@/pages/artist/Promote";

export const Route = createFileRoute("/artist/studio/promote")({ component: ArtistPromote });
