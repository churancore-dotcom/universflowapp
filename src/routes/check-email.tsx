import { createFileRoute } from "@tanstack/react-router";
import CheckEmail from "@/pages/CheckEmail";
import { routeSeo } from "@/lib/routeSeo";

export const Route = createFileRoute("/check-email")({
  head: () => routeSeo({
    title: "Check Your Email — Universflow",
    description: "Confirm your email address to continue with Universflow.",
    path: "/check-email",
  }),
  component: CheckEmail,
});
