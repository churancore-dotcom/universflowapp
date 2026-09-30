import { createFileRoute } from "@tanstack/react-router";
import LegalPrivacy from "@/pages/legal/Privacy";
import { routeSeo } from "@/lib/routeSeo";

export const Route = createFileRoute("/legal/privacy")({
  head: () => routeSeo({ title: "Privacy Policy — Universflow", description: "How Universflow collects, uses and protects your data when you stream music, create playlists and use the app.", path: "/legal/privacy" }),
  component: LegalPrivacy,
});
