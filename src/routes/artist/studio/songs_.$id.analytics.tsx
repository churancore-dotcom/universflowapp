import { createFileRoute } from "@tanstack/react-router";
import ArtistSongAnalyticsPage from "@/pages/artist/SongAnalytics";

export const Route = createFileRoute("/artist/studio/songs_/$id/analytics")({ component: ArtistSongAnalyticsPage });
