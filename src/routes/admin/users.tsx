import { createFileRoute } from "@tanstack/react-router";
import ManageUsers from "@/pages/admin/ManageUsers";

export const Route = createFileRoute("/admin/users")({ component: ManageUsers });
