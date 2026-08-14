import { createFileRoute } from "@tanstack/react-router";
import VerifyEmail from "@/pages/VerifyEmail";
import { routeSeo } from "@/lib/routeSeo";

export const Route = createFileRoute("/verify")({
  head: () => {
    const seo = routeSeo({
      title: "Verify Your Email — Universflow",
      description:
        "Confirm your email address to activate your Universflow account and start streaming and downloading music for free.",
      path: "/verify",
    });
    return { ...seo, meta: [...seo.meta, { name: "robots", content: "noindex, follow" }] };
  },
  component: VerifyEmail,
});
