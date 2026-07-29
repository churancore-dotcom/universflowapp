import { createFileRoute } from "@tanstack/react-router";
import ManageSongs from "@/pages/admin/ManageSongs";

export const Route = createFileRoute("/admin/songs")({ component: ManageSongs });
