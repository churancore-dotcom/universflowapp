import { createFileRoute } from "@tanstack/react-router";
import ManagePlaylists from "@/pages/admin/ManagePlaylists";

export const Route = createFileRoute("/admin/playlists")({ component: ManagePlaylists });
