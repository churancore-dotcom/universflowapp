import { createFileRoute } from "@tanstack/react-router";
import ArtistPublic from "@/pages/artist/ArtistPublic";

export const Route = createFileRoute("/a/$slug")({ component: ArtistPublic });
