import { createFileRoute } from "@tanstack/react-router";
import CheckEmail from "@/pages/CheckEmail";

export const Route = createFileRoute("/check-email")({ component: CheckEmail });
