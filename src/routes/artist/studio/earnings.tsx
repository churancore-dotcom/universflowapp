import { createFileRoute } from "@tanstack/react-router";
import ArtistEarnings from "@/pages/artist/Earnings";

export const Route = createFileRoute("/artist/studio/earnings")({ component: ArtistEarnings });
