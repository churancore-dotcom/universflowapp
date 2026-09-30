import { createFileRoute } from "@tanstack/react-router";
import LegalTerms from "@/pages/legal/Terms";
import { routeSeo } from "@/lib/routeSeo";

export const Route = createFileRoute("/legal/terms")({
  head: () => routeSeo({ title: "Terms of Service — Universflow", description: "The rules for using Universflow, the free music streaming app: accounts, acceptable use, content and liability.", path: "/legal/terms" }),
  component: LegalTerms,
});
