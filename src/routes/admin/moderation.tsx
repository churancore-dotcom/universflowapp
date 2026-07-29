import { createFileRoute } from "@tanstack/react-router";
import ContentModeration from "@/pages/admin/ContentModeration";

export const Route = createFileRoute("/admin/moderation")({ component: ContentModeration });
