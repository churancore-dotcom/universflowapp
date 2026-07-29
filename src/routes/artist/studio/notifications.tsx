import { createFileRoute } from "@tanstack/react-router";
import ArtistNotifications from "@/pages/artist/Notifications";

export const Route = createFileRoute("/artist/studio/notifications")({ component: ArtistNotifications });
