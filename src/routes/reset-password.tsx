import { createFileRoute } from "@tanstack/react-router";
import ResetPassword from "@/pages/ResetPassword";
import { routeSeo } from "@/lib/routeSeo";

export const Route = createFileRoute("/reset-password")({
  head: () => routeSeo({
    title: "Reset Password — Universflow",
    description: "Choose a new password for your Universflow account.",
    path: "/reset-password",
  }),
  component: ResetPassword,
});
