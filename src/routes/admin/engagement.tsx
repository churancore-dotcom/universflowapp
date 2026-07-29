import { createFileRoute } from "@tanstack/react-router";
import UserEngagement from "@/pages/admin/UserEngagement";

export const Route = createFileRoute("/admin/engagement")({ component: UserEngagement });
