import { createFileRoute } from "@tanstack/react-router";
import ArtistEditProfile from "@/pages/artist/EditProfile";

export const Route = createFileRoute("/artist/studio/profile")({ component: ArtistEditProfile });
