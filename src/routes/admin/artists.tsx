import { createFileRoute } from "@tanstack/react-router";
import ManageArtists from "@/pages/admin/ManageArtists";

export const Route = createFileRoute("/admin/artists")({ component: ManageArtists });
