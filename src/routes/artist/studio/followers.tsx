import { createFileRoute } from "@tanstack/react-router";
import ArtistFollowersPage from "@/pages/artist/Followers";

export const Route = createFileRoute("/artist/studio/followers")({ component: ArtistFollowersPage });
