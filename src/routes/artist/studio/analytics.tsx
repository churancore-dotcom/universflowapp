import { createFileRoute } from "@tanstack/react-router";
import ArtistAnalyticsPage from "@/pages/artist/Analytics";

export const Route = createFileRoute("/artist/studio/analytics")({ component: ArtistAnalyticsPage });
