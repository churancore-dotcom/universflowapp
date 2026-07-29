import { createFileRoute } from "@tanstack/react-router";
import ArtistSongsPage from "@/pages/artist/Songs";

export const Route = createFileRoute("/artist/studio/songs")({ component: ArtistSongsPage });
