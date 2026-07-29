import { createFileRoute } from "@tanstack/react-router";
import SupportInbox from "@/pages/admin/SupportInbox";

export const Route = createFileRoute("/admin/support")({ component: SupportInbox });
